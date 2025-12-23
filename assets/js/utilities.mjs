function _extractSpeakerAndUtterance(paragraphElement) {
	const speakerSpan = paragraphElement.querySelector('span.speaker');
	if (!speakerSpan) return null;
	
	const speaker = speakerSpan.textContent.trim();
	
	const rawHtmlOfP = paragraphElement.innerHTML;
	const speakerSpanHtml = speakerSpan.outerHTML;
	const speakerSpanEndIndex = rawHtmlOfP.indexOf(speakerSpanHtml) + speakerSpanHtml.length;
	let utteranceHtml = rawHtmlOfP.substring(speakerSpanEndIndex);
	
	if (utteranceHtml.startsWith(' ')) {
		utteranceHtml = utteranceHtml.substring(1);
	}
	
	let processedUtterance = utteranceHtml.replace(/<br\s*\/?>\s*&emsp;/gi, '\n\t');
	processedUtterance = processedUtterance.replace(/<br\s*\/?>/gi, '\n');
	
	const decoder = document.createElement('div');
	decoder.innerHTML = processedUtterance;
	const finalUtterance = decoder.textContent.trim();
	
	return { speaker, utterance: finalUtterance };
}

/**
 * Transforms platoHtml format to MPUJ (Multi-Part User JSON) array
 * for Gemini API.
 * Consecutive non-model messages are grouped into a single 'user' message
 * with multiple parts. Each part includes the speaker's name and utterance.
 * Model messages have a single part with the utterance.
 *
 * @param {string} platoHtml - The platoHtml formatted string.
 * @returns {Array<Object>} - An array of message objects suitable for Gemini API `contents`.
 *                            Each object has 'role' ('user' or 'model') and 'parts' (an array of text parts).
 *                            Returns an empty array if platoHtml is empty or whitespace.
 * @throws {Error} If platoHtml is null, undefined, or not a string.
 */
export function platoHtmlToMpuj(platoHtml, machineName) {
	if (platoHtml === null || typeof platoHtml !== 'string') {
		throw new Error('Invalid input: platoHtml must be a string.');
	}
	if (!platoHtml.trim()) {
		return []; // Return empty array for empty or whitespace-only HTML
	}

	const modelNameUpper = machineName.toUpperCase();

	const mpujMessages = [];
	let currentUserParts = []; // To accumulate parts for the current user message

	const parser = new DOMParser();
	const doc = parser.parseFromString(platoHtml, 'text/html');
	const paragraphs = doc.querySelectorAll('p.dialogue');

	paragraphs.forEach(p => {
		const speakerSpan = p.querySelector('span.speaker');
		if (!speakerSpan) {
			console.warn('Skipping paragraph due to missing speaker span:', p.outerHTML);
			return; // Skip malformed paragraphs
		}

		const speaker = speakerSpan.textContent.trim();

		// Extract utterance: text after the speaker span, with leading colon/whitespace removed.
		const fullParaText = p.textContent || '';
		let utterance = fullParaText.substring(speakerSpan.textContent.length).trim();
		if (utterance.startsWith(':')) {
			utterance = utterance.substring(1).trim();
		}

		const isModelMessage = speaker.toUpperCase() === modelNameUpper;

		if (isModelMessage) {
			// If there are accumulated user parts, push them as a single user message first.
			if (currentUserParts.length > 0) {
				mpujMessages.push({role: 'user', parts: currentUserParts});
				currentUserParts = []; // Reset for the next sequence of user messages
			}
			// Add the model message.
			mpujMessages.push({role: 'model', parts: [{text: utterance}]});
		} else {
			// This is a part of a user message (from any participant other than the model,
			// including "INSTRUCTIONS" if present).
			// The part includes the speaker's name and their utterance.
			currentUserParts.push({text: `${speaker}: ${utterance}`});
		}
	});

	// After iterating through all paragraphs, if there are any remaining user parts, add them.
	if (currentUserParts.length > 0) {
		mpujMessages.push({role: 'user', parts: currentUserParts});
	}

	return mpujMessages;
}

/**
 * Cleans and transforms text from Large Language Models (LLMs) by:
 * - Removing all Markdown formatting (bold, italics, headers, lists, code blocks, links, etc.).
 * - Consolidating multiple newlines into a consistent paragraph separator (`\n\t`).
 * - Removing extraneous tabs and multiple spaces.
 * - Trimming leading/trailing whitespace.
 *
 * @param {string} llmResponse The raw text response from an LLM.
 * @returns {string} The cleaned and formatted plain text.
 */
export function llmSoupToText(llmResponse) {
	if (typeof llmResponse !== 'string') {
		// Handle non-string inputs gracefully, e.g., by returning an empty string
		// or throwing an error, depending on desired behavior.
		console.warn('llmSoupToText received non-string input:', llmResponse);
		return '';
	}

	let text = llmResponse;

	// --- Step 1: Normalize Newlines & Initial Cleanup ---
	// Replace Windows newlines with Unix newlines for consistency
	text = text.replace(/\r\n/g, '\n');
	// Consolidate all sequences of two or more newlines into exactly two newlines.
	// This simplifies paragraph detection before further processing.
	text = text.replace(/\n{2,}/g, '\n\n');

	// --- Step 2: Remove Block-Level Markdown Elements ---
	// These are often multi-line and should be handled first to prevent partial removal.

	// Remove fenced code blocks (```language\ncode\n``` or ~~~language\ncode\n~~~)
	// The content within the code block is removed entirely as per "all markdown should be removed altogether".
	text = text.replace(/`{3,}[^\n]*\n([\s\S]*?)\n`{3,}/g, '');
	text = text.replace(/~{3,}[^\n]*\n([\s\S]*?)\n~{3,}/g, '');

	// Remove HTML comments (<!-- comment -->)
	text = text.replace(/<!--[\s\S]*?-->/g, '');

	// Remove basic HTML tags (e.g., <br>, <div>, <p>).
	// This regex is simple and might not handle all complex HTML, but covers common LLM output.
	text = text.replace(/<[^>]+>/g, '');

	// Remove horizontal rules (---, ***, ___ on a line by themselves)
	text = text.replace(/^\s*(?:-|\*|_){3,}\s*$/gm, '');

	// Remove blockquotes (just the '>' prefix). The content remains.
	text = text.replace(/^\s*>\s*/gm, '');

	// --- Step 3: Remove Inline Markdown Elements ---

	// Remove headers (ATX style: # Header, ## Header, etc.)
	text = text.replace(/^\s*#{1,6}\s*/gm, '');
	// Remove Setext headers (underlined headers: Header\n--- or Header\n===).
	// We keep the actual header text and remove the underline.
	text = text.replace(/^([^\n]+)\n\s*(?:=|-){2,}\s*$/gm, '$1');

	// Remove links and images (![alt](url), [text](url)). The entire markdown syntax is removed.
	text = text.replace(/!?\[.*?\]\(.*?\)/g, '');

	// Remove inline code (`code`). The content within the backticks remains, backticks are removed.
	// This aligns with "removing markdown" but preserving "meaningful" content.
	text = text.replace(/`([^`]+)`/g, '$1');

	// Remove bold formatting (**bold**, __bold__). Content remains.
	// Non-greedy `+?` ensures it matches the smallest possible string between delimiters.
	text = text.replace(/\*\*([^*]+?)\*\*/g, '$1');
	text = text.replace(/__([^_]+?)__/g, '$1');

	// Remove italic formatting (*italic*, _italic_). Content remains.
	// Careful with single underscores, ensures there's content inside to avoid matching `my_file.txt`.
	text = text.replace(/\*([^*]+?)\*/g, '$1');
	text = text.replace(/_([^_]+?)_/g, '$1');

	// Remove list markers (-, *, +, 1., 2.). The list item content remains.
	text = text.replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '');

	// --- Step 4: Final Whitespace & Paragraph Normalization ---

	// Remove leading/trailing whitespace from each line.
	// This helps clean up after removing various markdown elements.
	text = text.split('\n').map(line => line.trim()).join('\n');

	// Replace any remaining tabs with single spaces.
	text = text.replace(/\t/g, ' ');
	// Consolidate multiple spaces into single spaces.
	text = text.replace(/ {2,}/g, ' ');

	// The core paragraph transformation: replace double newlines with newline + tab.
	// This assumes `\n\n` consistently marks a paragraph break after the previous steps.
	text = text.replace(/\n\n/g, '\n\t');

	// --- Step 5: Final Trimming ---
	// Trim leading/trailing whitespace from the entire string.
	text = text.trim();

	// Remove any leading newlines or tabs that might result from aggressive trimming or transformations.
	text = text.replace(/^[\n\t]+/, '');
	// Ensure no multiple tabs appear at the start of paragraphs if there were many newlines initially.
	text = text.replace(/\n\t{2,}/g, '\n\t');

	return text;
}

/**
 * Transforms platoHtml format to platoText format using the helper.
 * @param {string} platoHtml - The platoHtml formatted string.
 * @returns {string} - The platoText formatted string.
 */
export function platoHtmlToPlatoText(platoHtml) {
	if (typeof platoHtml !== 'string' || !platoHtml.trim()) {
		return '';
	}
	
	let result = ''; // Correctly initialized to an empty string
	const parser = new DOMParser();
	const doc = parser.parseFromString(platoHtml, 'text/html');
	const paragraphs = doc.querySelectorAll('p.dialogue');
	
	paragraphs.forEach(p => {
		const extracted = _extractSpeakerAndUtterance(p);
		if (extracted) {
			const {
				speaker,
				utterance
			} = extracted;
			if (speaker || utterance) {
				result += `${speaker}: ${utterance}\n\n`;
			}
		}
	});
	
	return result;
}

/**
 * Transforms platoHtml format to CMJ format using the helper.
 * @param {string} platoHtml - The platoHtml formatted string.
 * @param {string} machineName - The name of the assistant/machine.
 * @returns {Array<Object>}
 */
export function platoHtmlToCmj(platoHtml, machineName) {
	if (!platoHtml || typeof platoHtml !== 'string') {
		throw new Error('Invalid input: platoHtml must be a non-empty string');
	}
	if (!machineName) {
		throw new Error('machineName is required for role assignment.');
	}
	
	const messages = [];
	const parser = new DOMParser();
	const doc = parser.parseFromString(platoHtml, 'text/html');
	const paragraphs = doc.querySelectorAll('p.dialogue');
	const assistantNameUpper = machineName.toUpperCase();
	
	paragraphs.forEach(p => {
		const extracted = _extractSpeakerAndUtterance(p);
		if (extracted) {
			const {
				speaker,
				utterance
			} = extracted;
			
			let role = 'user';
			if (speaker.toUpperCase() === assistantNameUpper) {
				role = 'assistant';
			} else if (speaker.toUpperCase() === 'INSTRUCTIONS') {
				role = 'system';
			}
			
			messages.push({
				role: role,
				name: speaker,
				content: utterance
			});
		}
	});
	
	return messages;
}

/**
 * Transforms platoText format to platoHtml format.
 * @param {string} platoText - The platoText formatted string.
 * @returns {string} - The platoHtml formatted string.
 */
export function platoTextToPlatoHtml(platoText) {
	if (typeof platoText !== 'string') {
		throw new Error('Invalid input: platoText must be a string');
	}
	const trimmedPlatoText = platoText.trim();
	if (!trimmedPlatoText) {
		return '';
	}

	let result = '';
	// Split by \n\n only if it's followed by a speaker pattern.
	const messageBlocks = trimmedPlatoText.split(/\n\n(?=[A-Za-z0-9_-]+:\s*)/g);

	messageBlocks.forEach(block => {
		const currentBlock = block.trim();
		if (!currentBlock) return;

		const speakerMatch = currentBlock.match(/^([A-Za-z0-9_-]+):\s*/);
		if (!speakerMatch) {
			// This block doesn't start with a speaker. Could be pre-dialogue text or malformed.
			// Depending on requirements, you might log this or handle it differently.
			// For now, we'll skip it as the primary goal is parsing speaker lines.
			console.warn('platoTextToPlatoHtml: Skipping block that does not start with a speaker pattern:', currentBlock);
			return;
		}

		const speaker = speakerMatch[1];
		const rawUtterance = currentBlock.substring(speakerMatch[0].length);

		// Replace "orphaned" double (or more) newlines within the utterance with '\n\t', then trim.
		// The trim handles cases where an utterance might start or end with newlines.
		const semanticallyProcessedUtterance = rawUtterance.replace(/\n{2,}/g, '\n\t').trim();

		// Escape HTML special characters and format for HTML display
		const escapedAndFormattedUtterance = semanticallyProcessedUtterance
			.replace(/&/g, '&amp;')      // 1. Ampersands first
			.replace(/</g, '&lt;')       // 2. Less than
			.replace(/>/g, '&gt;')       // 3. Greater than
			.replace(/"/g, '&quot;')    // 4. Double quotes
			.replace(/'/g, '&#039;')   // 5. Single quotes (or &apos;)
			.replace(/\t/g, '&emsp;')    // 6. Convert semantic tab to visual em-space for HTML
			.replace(/\n/g, '<br />');   // 7. Convert semantic newline to <br /> for HTML

		result += `<p class="dialogue"><span class="speaker">${speaker}</span> ${escapedAndFormattedUtterance}</p>\n`;
	});

	return result.trimEnd(); // Remove trailing newline if any
}

/**
 * Transforms an array of CMJ message objects to platoText format.
 * @param {Array<Object>} cmjMessages - An array of CMJ message objects.
 *                                      Each object should have 'name' and 'content' properties.
 * @returns {string} - The platoText formatted string.
 */
export function CmjToPlatoText(cmjMessages) {
	if (!Array.isArray(cmjMessages)) {
		console.error('Invalid input: cmjMessages must be an array.');
		// Consider throwing an error for more robust handling:
		// throw new Error('Invalid input: cmjMessages must be an array.');
		return ''; // Return empty string if input is not an array
	}
	let platoText = '';

	cmjMessages.forEach(message => {
		// Ensure the message object has the expected 'name' and 'content' properties
		if (message && typeof message.name === 'string' && typeof message.content === 'string') {
			const speaker = message.name.trim();
			// Normalize newlines within the LLM's utterance:
			// - Convert sequences of two or more newlines to '\n\t'
			//   to match platoText's internal paragraph formatting.
			// - Then, trim the result.
			let utterance = message.content.replace(/\n{2,}/g, '\n\t');
			utterance = utterance.trim();

			// Append the formatted string, ensuring it ends with two newlines
			platoText += `${speaker}: ${utterance}\n\n`;
		} else {
			console.warn('Skipping malformed CMJ message object during CmjToPlatoText conversion:', message);
		}
	});
	return platoText;
}

