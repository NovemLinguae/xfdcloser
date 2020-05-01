import Task from "../Components/Task";
import { rejection } from "../../util";
// <nowiki>

/**
 * 
 * @param {Object} config
 * @param {Object} options
 *  @param {String} [options.target] target (wikitext)
 *  @param {String} [options.rationale] additional rationale (wikitext)
 */
function CloseDiscussionTask(config, options) {
	config = {label: "Closing discussion", ...config};
	// Call parent constructor
	CloseDiscussionTask.super.call( this, config );
	// Additional data that may be present
	this.target = options.target;
	this.rationale = options.rationale;
}
OO.inheritClass( CloseDiscussionTask, Task );

CloseDiscussionTask.prototype.doTask = function() {
	this.setTotalSteps(1);
	const appConfig = this.appConfig;

	// Get nomination page content and remove {Closing} etc templates if present
	return this.api.get( {
		action: "query",
		titles: this.discussion.nomPage,
		prop: "revisions",
		rvprop: "content|timestamp",
		rvslots: "main",
		rvsection: this.discussion.sectionNumber,
		formatversion: "2"
	} )
		.then( response => {
			if (this.aborted) return rejection("Aborted");

			const revision = response.query.pages[0].revisions[0];
			const contents = revision.slots.main.content;
			const lastEditTime = revision.timestamp;
		
			// Check if already closed
			if ( contents.includes(this.venue.wikitext.alreadyClosed) ) {
				return rejection(
					"abort", null,
					"Discussion already closed (reload page to see the actual close)"
				);
			}
		
			// Check for edit conflict based on start time (only possible for AFDs/MFDs)
			if ( this.venue.type === "afd" || this.venue.type === "mfd" ) {
				var editedSinceScriptStarted = appConfig.startTime < new Date(lastEditTime);
				if ( editedSinceScriptStarted ) {
					return rejection(
						"abort", null,
						"Edit conflict detected"
					);
				}
			}

			// Check for possible edit conflict based on section heading
			const section_heading = contents.slice(0, contents.indexOf("\n"));
			const decodeHtml = function(t) {
				return $("<div>").html(t).text();
			};
			const plain_section_heading = decodeHtml( section_heading
				.replace(/(?:^\s*=*\s*|\s*=*\s*$)/g, "") // remove heading markup
				.replace(/\[\[:?(?:[^\]]+\|)?([^\]]+)\]\]/g, "$1") // replace link markup with link text
				.replace(/{{\s*[Tt]l[a-z]?\s*\|\s*([^}]+)}}/g, "{{$1}}") // replace tl templates
				.replace(/s*}}/, "}}") // remove any extra spaces after replacing tl templates
				.replace(/\s{2,}/g, " ") // collapse multiple spaces into a single space
				.trim()
			);
			const isCorrectSection = plain_section_heading === this.discussion.sectionHeader;
			if ( !isCorrectSection ) {
				return rejection(
					"abort", null,
					"Possible edit conflict (found section heading `" + plain_section_heading + "`)"
				);
			}

			// Add wikitext above/below discussion
			const xfd_close_top = this.venue.wikitext.closeTop
				.replace(/__RESULT__/, this.result || "&thinsp;")
				.replace(/__TO_TARGET__/, this.target ? " to " + this.target : "")
				.replace(/__RATIONALE__/, this.rationale || ".")
				.replace(/__SIG__/, this.appConfig.user.sig);
			const section_contents = contents.slice(contents.indexOf("\n") + 1).replace(
				/({{closing}}|{{AfDh}}|{{AfDb}}|\{\{REMOVE THIS TEMPLATE WHEN CLOSING THIS AfD\|.?\}\}|<noinclude>\[\[Category:Relisted AfD debates\|.*?\]\](\[\[Category:AfD debates relisted 3 or more times|.*?\]\])?<\/noinclude>)/gi,
				"");
			const updated_top = ( this.venue.type === "afd" || this.venue.type === "mfd" )
				? xfd_close_top + "\n" + section_heading
				: section_heading + "\n" + xfd_close_top;
			const updated_section = updated_top + "\n" + section_contents.trim() + "\n" + this.venue.wikitext.closeBottom;
		
			return this.api.postWithToken( "csrf", {
				action: "edit",
				title: this.discussion.nomPage,
				section: this.discussion.sectionNumber,
				text: updated_section,
				summary: `/* ${this.discussion.sectionHeader} */ Closed as ${this.result}${this.appConfig.script.advert}`,
				basetimestamp: lastEditTime
			} );
		} )
		.then(
			() => { this.trackStep(); },
			(code, error, abortReason) => {
				if (code === "abort") {
					this.addError(
						abortReason ? "Aborted: " + abortReason : "Aborted",
						{abort: true}
					);
				} else {
					this.addError(
						`Could not edit page ${extraJs.makeLink(this.discussion.nomPage).get(0).outerHTML}; could not close discussion`,
						{code, error, abort: true}
					);
				}
				return rejection();
			}
		);

};

export default CloseDiscussionTask;
// </nowiki>