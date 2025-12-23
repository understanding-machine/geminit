// worker.js
let machineConfig = null;
let messages = null;
let garbage = null;
let llmSettings = null;

self.onmessage = async function (event) {
	// Parameters for the LLM API call from the main thread
	machineConfig = event.data.config;
	console.log('Worker received machine config:', machineConfig);
	llmSettings = event.data.settings;
	messages = event.data.messages;
	console.log('Worker received messages:', messages);
	garbage = [
		{'category': 'HARM_CATEGORY_HATE_SPEECH', 'threshold': 'BLOCK_NONE'},
		{'category': 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'threshold': 'BLOCK_NONE'},
		{'category': 'HARM_CATEGORY_DANGEROUS_CONTENT', 'threshold': 'BLOCK_NONE'},
		{'category': 'HARM_CATEGORY_HARASSMENT', 'threshold': 'BLOCK_NONE'}
	]

	try {
		// --- 1. Fetch token was here ---
		// --- 2. Fetch instruction ---
		let instructionText; // Declare here to ensure it's in scope
		try {
			console.log(`Worker: Fetching the Machine instruction from ${machineConfig.server}`);
			const instructionResponse = await fetch(machineConfig.server + '/' + machineConfig.instructions_file, {mode: "cors"});
			if (!instructionResponse.ok) {
				console.log(`Worker: HTTP error fetching instruction! status: ${instructionResponse.status}. Using default instruction.`);
				// Default instruction if fetching fails or file not found
				instructionText = "You are a helpful assistant.";
			} else {
				instructionText = (await instructionResponse.text()).trim();
				console.log('Worker: Instruction fetched successfully.');
				console.log('Worker: Instruction:', instructionText);
			}
		} catch (fetchError) {
			console.error('Worker: Error during instruction file fetch:', fetchError.message, '. Using default instruction.');
			instructionText = "You are a helpful assistant."; // Default instruction on any fetch error
		}

		// --- 3. Prepare messages for the API call ---
		const systemInstructionMessage = {role: "developer", parts: [{text: instructionText}]};
		let messagesForApi;

		// Check if the main thread sent any messages
		if (messages && Array.isArray(messages) && messages.length > 0) {
			// User provided messages: unshift/prepend the fetched system instruction
			messagesForApi = [messages];
			console.log('All messages for API:', messagesForApi)
		} else {
			// No messages from user, or an empty array: use the system instruction and a default user message
			messagesForApi = [
				{role: "user", parts: [{text: "What model are you?"}]} // Default user message
			];
		}

		// --- 4. Prepare the final API URL ---
		console.log(`Worker: The fallback_llm name is: ${machineConfig.fallback_llm}`);
		const llm = llmSettings.model || machineConfig.fallback_llm;
		const apiUrl = machineConfig.apiUrl + llm + ':generateContent?key=' + llmSettings.token

		// --- 4. Prepare the final API payload ---
		const apiParameters = {
			systemInstruction: systemInstructionMessage,
			safetySettings: garbage,
			generationConfig: {
				stopSequences: ['STOP', 'Title'],
				responseMimeType: 'text/plain',
				responseModalities: ['TEXT'],
				temperature: llmSettings.temperature || 0.5,
				maxOutputTokens: llmSettings.maxOutputTokens || 10000,
				candidateCount: 1,
				topP: llmSettings.topP || 0.9,
				topK: llmSettings.topK || 50,
				enableEnhancedCivicAnswers: false,
				thinkingConfig: {
					thinkingLevel: llmSettings.thinkingLevel || 'low',
					includeThoughts: llmSettings.includeThoughts || true
				}
			}
		};

		// Merge default parameters, then incoming user parameters (which might override temp, max_tokens, etc.),
		const finalApiPayload = {
			...apiParameters,
			contents: messagesForApi      // Ensure our carefully constructed messages array is used
		};
		console.log('Worker: Here is the final API payload:', finalApiPayload);


		// --- 5. Make the LLM API call ---
		const apiOptions = {
			method: 'POST',
			body: JSON.stringify(finalApiPayload)
		};

		console.log('Worker: Making API call, Gemini API with payload:', finalApiPayload);
		const apiCallResponse = await fetch(apiUrl, apiOptions);
		// const apiCallResponse = JSON.stringify({candidates: [{role: "model", content: {parts:[{text: "This is a test"}]}}]})

		if (!apiCallResponse.ok) {
			let errorDetails = await apiCallResponse.text();
			try {
				// Try to parse if the error response is JSON for more structured info
				errorDetails = JSON.parse(errorDetails);
			} catch (e) {
				// It's not JSON, use the raw text
			}
			console.error('Worker: API Error Response:', errorDetails);
			throw new Error(`API Error: ${apiCallResponse.status} - ${typeof errorDetails === 'string' ? errorDetails : JSON.stringify(errorDetails)}`);
		}

		const apiData = await apiCallResponse.json();
		console.log('Worker: API call successful, response:', apiData);
		const choice = apiData.candidates[0]
		console.log('Worker: API choice:', choice);

		// Send the successful result back to the main thread
		self.postMessage({type: 'success', data: choice});

	} catch (error) {
		console.error('Worker: An error occurred:', error.message, error); // Log the full error object for more details
		// Send the error back to the main thread
		self.postMessage({type: 'error', error: error.message});
	}
};

console.log('Worker: Script loaded and ready for messages.');
