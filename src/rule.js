const _ = require('lodash');
const utils = require('./utils');

/**
 * Helper utils for working with filtering rules
 */

/**
* @param {*} rule - rule to check
* @returns {Boolean} true if rule is a comment
*/
function isComment(rule) {
    return _.startsWith(rule, '!')
        || _.startsWith(rule, '# ')
        || rule === '#'
        || _.startsWith(rule, '####');
}

/**
 * @param {String} ruleText - rule to check
 * @returns {Boolean} true if this is a /etc/hosts rule
 */
function isEtcHostsRule(ruleText) {
    return /^([a-f0-9.:\][]+)(%[a-z0-9]+)?\s+([^#]+)(#.*)?$/.test(ruleText);
}

/**
 * Represents a /etc/hosts rule
 * @typedef {Object} AdblockRuleTokens
 * @property {String} pattern - rule pattern
 * @property {String} options - modifiers
 * @property {Boolean} whitelist - whether the rule is whitelist or not
 */

/**
 * parseRuleTokens splits the rule text in multiple tokens
 * @param {String} ruleText - original rule text
 * @returns {AdblockRuleTokens} rule tokens
 */
function parseRuleTokens(ruleText) {
    const tokens = {
        pattern: null,
        options: null,
        whitelist: false,
    };

    let startIndex = 0;
    if (_.startsWith(ruleText, '@@')) {
        tokens.whitelist = true;
        startIndex = 2;
    }

    if (ruleText.length <= startIndex) {
        throw new TypeError(`the rule is too short: ${ruleText}`);
    }

    // Setting pattern to rule text (for the case of empty options)
    tokens.pattern = ruleText.substring(startIndex);

    // Avoid parsing options inside of a regex rule
    if (_.startsWith(tokens.pattern, '/')
        && _.endsWith(tokens.pattern, '/')
        && tokens.pattern.indexOf('replace=') === -1) {
        return tokens;
    }

    for (let i = ruleText.length; i >= startIndex; i -= 1) {
        const c = ruleText[i];
        if (c === '$') {
            if (i > startIndex && ruleText[i - 1] === '\\') {
                // Escaped, doing nothing
            } else {
                tokens.pattern = ruleText.substring(startIndex, i);
                tokens.options = ruleText.substring(i + 1);
                break;
            }
        }
    }

    return tokens;
}

/**
 * Represents a /etc/hosts rule
 * @typedef {Object} EtcHostsRule
 * @property {String} ruleText - original rule text
 * @property {Array<String>} hostnames - list of hostnames in the rule
 */

/**
 * Extracts rule properties from an /etc/hosts entry.
 *
 * @param {String} ruleText - rule text
 * @returns {EtcHostsRule} - rule properties
 * @throws {TypeError} thrown if it is not a valid /etc/hosts rule
 */
function loadEtcHostsRuleProperties(ruleText) {
    let rule = _.trim(ruleText);
    if (rule.indexOf('#') > 0) {
        rule = rule.substring(0, rule.indexOf('#'));
    }

    const [, ...hostnames] = _.trim(rule).split(/\s+/);
    if (hostnames.length < 1) {
        throw new TypeError(`Invalid /etc/hosts rule: ${ruleText}`);
    }

    return {
        ruleText,
        hostnames,
    };
}

/**
 * Represents an adblock-style rule
 * @typedef {Object} AdblockRule
 * @property {String} ruleText - original rule text
 * @property {String} pattern - matching pattern
 * @property {Array<{{name: string, value: string}}>} options - list of rule modifiers
 * @property {Boolean} whitelist - whether this is an exception rule or not
 * @property {String} hostname - hostname can only be extracted from the rules
 *                               that look like `||[a-z0-9-.]^.*`
 */

/**
 * Extracts hostname from the adblock rule pattern
 *
 * @param {String} pattern adblock rule pattern string
 * @returns {String} hostname or null if cannot be extracted
 */
function extractHostname(pattern) {
    pattern.match(/^||([a-z0-9-.])\^$/);
    const match = pattern.match(/^\|\|([a-z0-9-.]+)\^$/);
    const hostname = match ? match[1] : null;
    return hostname;
}

/**
 * Extracts rule properties from an adblock-style rule.
 *
 * @param {String} ruleText - rule text
 * @returns {AdblockRule} - rule properties
 */
function loadAdblockRuleProperties(ruleText) {
    const tokens = parseRuleTokens(_.trim(ruleText));
    const rule = {
        ruleText,
        pattern: tokens.pattern,
        whitelist: tokens.whitelist,
        options: null, // to be filled later
        hostname: extractHostname(tokens.pattern),
    };

    if (tokens.options) {
        const optionParts = utils.splitByDelimiterWithEscapeCharacter(tokens.options, ',', '\\', false);
        if (optionParts.length > 0) {
            rule.options = [];

            // eslint-disable-next-line no-restricted-syntax
            for (const option of optionParts) {
                const parts = _.split(option, '=', 2);
                const name = parts[0];
                const value = parts[1] ? parts[1] : null;
                rule.options.push({
                    name,
                    value,
                });
            }
        }
    }

    return rule;
}

/**
 * Finds the specified modifier in the AdblockRule properties
 *
 * @param {AdblockRule} ruleProps - rule properies
 * @param {String} name - modifier name
 * @returns {{name: string, value: string} | null} modifier info or null if not found
 */
function findModifier(ruleProps, name) {
    if (!ruleProps.options) {
        return null;
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const option of ruleProps.options) {
        if (option.name === name) {
            return option;
        }
    }

    return null;
}

/**
 * Removes the specified modifier from the list of the rule modifiers
 *
 * @param {AdblockRule} ruleProps - rule properties
 * @param {String} name - modifier name
 * @returns {Boolean} true if there was such a modifier and it was removed
 */
function removeModifier(ruleProps, name) {
    if (!ruleProps.options) {
        return false;
    }

    let found = false;
    for (let iOptions = ruleProps.options.length - 1; iOptions >= 0; iOptions -= 1) {
        const option = ruleProps.options[iOptions];
        if (option.name === name) {
            ruleProps.options.splice(iOptions, 1);
            found = true;
        }
    }

    return found;
}

/**
 * Converts {@link AdblockRule} to string.
 *
 * @param {AdblockRule} ruleProps - rule properties
 * @returns {String} rule text
 */
function adblockRuleToString(ruleProps) {
    let ruleText = '';
    if (ruleProps.whitelist) {
        ruleText = '@@';
    }
    ruleText += ruleProps.pattern;
    if (!_.isEmpty(ruleProps.options)) {
        ruleText += '$';
        for (let i = 0; i < ruleProps.options.length; i += 1) {
            const option = ruleProps.options[i];
            ruleText += option.name;
            if (option.value) {
                ruleText += '=';
                ruleText += option.value;
            }
            if (i < ruleProps.options.length - 1) {
                ruleText += ',';
            }
        }
    }

    return ruleText;
}

module.exports = {
    isComment,
    isEtcHostsRule,
    loadEtcHostsRuleProperties,
    loadAdblockRuleProperties,
    findModifier,
    removeModifier,
    adblockRuleToString,
};
