import config from "./config";
// <nowiki>

/**
 * Un-escapes some HTML tags (<br>, <p>, <ul>, <li>, <hr>, <strong>, <em>, and <pre>);
 * turns wikilinks into real links. Ignores anything within <pre>...</pre> tags -- unless
 * wrapped with {{subst:^|}} (e.g. `{{subst:^|<strong>}}` is replaced with a real <strong> tag).
 * Input will first be escaped using mw.html.escape() unless specified 
 * @param {String} text
 * @param {Object} config Configuration options
 * @config {Boolean} noEscape - do not escape the input first
 * @returns {String} unescaped text
 */
var safeUnescape = function(text, config) {
	return ( config && config.noEscape && text || mw.html.escape(text) )
	// Step 1: unescape <pre> tags
		.replace(  
			/&lt;(\/?pre\s?\/?)&gt;/g,
			"<$1>"
		)
	// Step 2: replace piped wikilinks with real links (unless inside <pre> tags)
		.replace( 
			/\[\[([^|\]]*?)\|([^|\]]*?)\]\](?![^<]*?<\/pre>)/g,
			"<a href=\"" + mw.util.getUrl("$1") + "\" target=\"_blank\">$2</a>"
		)
	// Step 3: replace other wikilinks with real links (unless inside <pre> tags)
		.replace( 
			/\[\[([^|\]]+?)]\](?![^<]*?<\/pre>)/g,
			"<a href=\"" + mw.util.getUrl("$1") + "\" target=\"_blank\">$1</a>"
		)
	// Step 4: unescape other tags (unless inside <pre> tags)
		.replace(
			/&lt;(\/?(?:br|p|ul|li|hr|strong|em)\s?\/?)&gt;(?![^<]*?<\/pre>)/g,
			"<$1>"
		)
	// Step 5: unescape tags warpped in {{subst:^|}}
		.replace(
			/{{subst:\^\|&lt;(\/?(?:br|p|ul|li|hr|strong|em)\s?\/?)&gt;}}/g,
			"<$1>"
		);
};

var dmyDateString = function(date) {
	return date.getUTCDate().toString() + " " +
		config.monthNames[date.getUTCMonth()] + " " +
		date.getUTCFullYear().toString();
};

/**
 * Generates a JS Date object from the text of a timestamp
 * @param {String} sigTimestamp in format "`hh`:`mm`, `d` `Month` `yyyy` (UTC)", e.g. "09:42, 11 January 2019 (UTC)"
 * @returns {Date|NaN} Date object, or NaN if sigTimestamp could not be parsed
 */
var dateFromSigTimestamp = function(sigTimestamp) {
	var pattern = /(\d\d:\d\d), (\d{1,2}) (\w+) (\d\d\d\d) \(UTC\)/;
	var parts = pattern.exec(sigTimestamp);
	if ( parts === null ) {
		return NaN;
	}
	var year = parts[4];
	var monthIndex = config.wgMonthNames.indexOf(parts[3]);
	if ( monthIndex === -1 ) {
		return NaN;
	}
	var month = ( monthIndex < 10 )
		? "0" +  monthIndex
		: monthIndex;
	var day = ( parts[2].length === 1 )
		? "0" + parts[2]
		: parts[2];
	var time = "T" + parts[1] + "Z";
	var iso8601DateString = year + "-" + month + "-" + day + time;
	return Date.parse(iso8601DateString) && new Date(iso8601DateString);
};

var arrayFromResponsePages = function(response) {
	return $.map(response.query.pages, function(page) { return page; });
};

var pageFromResponse = function(response) {
	return arrayFromResponsePages(response)[0];
};

// Additional functions for working with mw.Title objects
var hasCorrectNamespace = function(mwTitleObject) {
	return (
		config.venue.ns_number === null ||
		config.venue.ns_number.includes(mwTitleObject.getNamespaceId())
	);
};
var setExistence = function(mwTitleObject, exists) {
	mw.Title.exist.set(mwTitleObject.toString(), exists);
};

/** multiButtonConfirm
 * @param {Object} config
 * @config {String} title  Title for the dialogue
 * @config {String} message  Message for the dialogue. HTML tags (except for <br>, <p>, <ul>,
 *  <li>, <hr>, and <pre> tags) are escaped; wikilinks are turned into real links.
 * @config {Array} actions  Optional. Array of configuration objects for OO.ui.ActionWidget
 *  <https://doc.wikimedia.org/oojs-ui/master/js/#!/api/OO.ui.ActionWidget>.
 *  If not specified, the default actions are 'accept' (with label 'OK') and 'reject' (with
 *  label 'Cancel').
 * @config {String} size  Symbolic name of the dialog size: small, medium, large, larger or full.
 * @return {Promise<String>} action taken by user
 */
var multiButtonConfirm = function(config) {
	var dialogClosed = $.Deferred();
	
	// Wrap message in a HtmlSnippet to prevent escaping
	var htmlSnippetMessage = new OO.ui.HtmlSnippet(
		safeUnescape(config.message)
	);

	var windowManager = new OO.ui.WindowManager();
	var messageDialog = new OO.ui.MessageDialog();
	$("body").append( windowManager.$element );
	windowManager.addWindows( [ messageDialog ] );
	windowManager.openWindow( messageDialog, {
		"title": config.title,
		"message": htmlSnippetMessage,
		"actions": config.actions,
		"size": config.size
	} );
	windowManager.on("closing", function(_win, promise) {
		promise.then(function(data) {
			dialogClosed.resolve(data && data.action);
			windowManager.destroy();
		});
	});

	return dialogClosed.promise();
};

/**
 * Merge two objects recursively, including arrays. Returns a new object without modifying either input.
 * Keys present in both the target and the source take on the value of the source, except if:
 * - both are objects, in which case those objects are merged
 * - both are arrays, in which case those arrays are merged  
 * 
 * @param {Object} target
 * @param {Object} source
 * @returns {Object} merged object
 */
const recursiveMerge = (target, source) => {
	const result = {};
	// Get all keys from both objects
	const keys = Object.keys({...target, ...source});
	// Check if the value each key is an array, or plain object, or neither
	keys.forEach(key => {
		if ( Array.isArray(target[key]) && Array.isArray(source[key]) ) {
			// Both values are arrays, so merge them
			result[key] = [...target[key], ...source[key]];
		} else if ( $.isPlainObject(target[key]) && $.isPlainObject(source[key])) {
			// Both values are plain objects, so recursively merge them
			result[key] = recursiveMerge(target[key], source[key]);
		} else if (source[key] === undefined) {
			// Key only exists on target, so use that value
			result[key] = target[key];
		} else {
			result[key] = source[key];
		}
	});
	return result;
};

const rejection = function() {
	return $.Deferred().reject(...arguments);
};

export { 
	safeUnescape,
	dmyDateString,
	dateFromSigTimestamp,
	hasCorrectNamespace,
	setExistence,
	arrayFromResponsePages,
	pageFromResponse,
	multiButtonConfirm,
	recursiveMerge,
	rejection
};
// </nowiki>