'use strict';
var parse = require('css-parse'),
    fs = require('fs'),
    humanize = require('humanize'),
    zlib = require('zlib'),
    _ = require('lodash');

/**
 * Processes an array of CSS selectors and returns an array of unique elements
 * @param {array} selectors - array of selectors as strings
 * @returns {array} list of elements
 */
function extractElementsFromSelectors(selectors) {
    // a note about the two utility methods defined below...
    //
    // the use of a regexp to extract elements from a CSS rule is
    // non-optimial, but it generally works. the reason for this approach
    // is that rework's CSS parser does not reprerent selectors any more
    // granularly than
    //
    // in the ideal world, we'd use something like css-selector-tokenizer
    // <https://github.com/css-modules/css-selector-tokenizer>, but that
    // feels a bit too heavy for what we need right now.

    /**
      * utility method (iteratee) to split a selector into individual elements
      * and return the unique elements
      * @todo write tests for this.
      */
    function splitSelectors(sel) {
        return _.uniq(sel.split(" "));
    }

    /**
      * utility method (iteratee) to remove an element's psuedoclasses
      * @todo write tests for this. see http://www.w3.org/TR/selectors/#selectors
      */
    function removePseudoclasses(el) {
        var psuedoclassRegex = /(\:?\:[^:]+)+/;
        el = el.replace(psuedoclassRegex, '');
        return el;
    }

    /**
      * utility method (iteratee) to reject unwanted elements from reports.
      * @todo write tests for this. see http://www.w3.org/TR/selectors/#selectors
      */
    function rejectGarbage(item) {
        var rejectables = [
            '',                  // remove empty strings
            '\\>', '\\+', '\\~', // remove combinators
            '\\*', 'html'        // remove "obvious" elements
        ];

        var rejectRegexp = new RegExp('^(' + rejectables.join('|') + ')$', 'i');
        var ignore = rejectRegexp.test(item);

        // if (ignore) {
        //     console.log('rejecting ' + item);
        // }

        return ignore;
    }

    var elements = _.chain(selectors)
        .map(splitSelectors)
        .flatten()
        .sort()
        .uniq()
        .map(removePseudoclasses)
        .uniq()
        .reject(rejectGarbage)
        .value();

    return elements;
}


/**
  * @property {Array} rules - contains all rules
  * @property {Array} selectors - contains all selectors
  * @property {Array} elements - contains all unique elements
  */
function CSSMetrics (path) {
    this.path = path;
    this.file = fs.readFileSync(this.path, 'utf8');
    this.fileStats = fs.statSync(this.path);
    this.parsedData = parse(this.file).stylesheet;

    this.rules = [];
    this.selectors = [];
    this.elements = [];
}

CSSMetrics.prototype = {

    humanize: function(bytes) {
        return humanize.filesize(bytes);
    },

    fileSize: function() {
        return fs.statSync(this.path).size;
    },

    gzipSize: function(callback) {
        zlib.gzip(this.file, function(error, buffer) {
            callback(buffer.length);
        });
    },

    processRules: function() {
        var selectors = [],
            rules = [],
            elements = [];

        // rules in css-parse are slightly abstract, so we need to handle all
        // the different rules differently. see https://github.com/reworkcss/css#ast
        function processActualRules(rule) {
            switch (rule.type) {
                // process actual CSS rules
                case 'rule':
                    // the selectors property is an array, and we want that array
                    // appended to the existing (single-dimensional) array.
                    selectors = selectors.concat(rule.selectors);

                    // append the processed rule to an array for tabulating later.
                    rules.push(rule);
                    break;

                // handle nested rules by recursing
                case 'media':
                case 'supports':
                case 'host':
                case 'document':
                    rule.rules.forEach(processActualRules);
                    break;

                // do nothing in all other cases: comments, other at-rules
                // (page, charset, etc.)
                default:
                    break;
            }

            return;
        }

        this.parsedData.rules.forEach(processActualRules);

        this.selectors = selectors;
        this.elements = extractElementsFromSelectors(selectors);
        this.rules = rules;
    },

    stats: function (callback) {
        this.processRules();

        var self = this,
            totalRules = this.rules.length,
            totalSelectors = this.selectors.length,
            fileSize = this.fileSize();

        this.gzipSize(function(gzipSize) {
            callback({
                totalRules: totalRules,
                totalSelectors: totalSelectors,
                allSelectors: self.selectors.join("\n"),
                allElements: self.elements.join("\n"),
                averageSelectors: +(totalSelectors / totalRules).toFixed(1),
                rawFileSize: fileSize,
                fileSize: self.humanize(fileSize),
                gzipSize: self.humanize(gzipSize)
            });
        });
    }
};

module.exports = CSSMetrics;
