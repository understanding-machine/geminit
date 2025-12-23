import {
  platoHtmlToPlatoText,
  platoTextToPlatoHtml,
  platoHtmlToCmj,
  platoHtmlToMpuj,
  CmjToPlatoText,
  llmSoupToText
} from './utilities.mjs';
import {
  showTokenPopup,
  hideTokenPopup
} from './token_popup.mjs';

/**
 * Manages the entire state and behavior of the machine page application.
 */
class MachineApp {
  /**
   * @param {HTMLElement} configElement The DIV element holding all the data-attributes.
   */
  constructor(configElement) {
    if (!configElement) {
      console.error('MachineApp cannot be initialized without a config element.');
      return;
    }
    this.configElement = configElement;
    
    // Initialize properties to hold our app's state
    this.settings = {};
    this.elements = {};
    
    // Kick off the setup process
    this._initialize();
  }
  
  /**
   * Main initialization sequence.
   */
  _initialize() {
    this._parseSettings();
    this._getElements();
    this._attachEventListeners();
    this.updateDisplayState(); // Perform the initial display setup
  }
  
  /**
   * Parses all settings from the config element and URL query parameters.
   */
  _parseSettings() {
    this.settings = {
      machine: JSON.parse(this.configElement.dataset.machineSettings),
      github: JSON.parse(this.configElement.dataset.githubSettings),
      llm: JSON.parse(this.configElement.dataset.lmSettings),
      app: JSON.parse(this.configElement.dataset.appSettings),
      workerUrl: this.configElement.dataset.workerUrl,
    };
    
    console.log('Machina settings loaded:', this.settings.machine);
    console.log('LLM settings loaded:', this.settings.llm);
    
    this._applyQueryParameters();
    console.log('Final LLM Settings:', this.settings.llm);
    console.log('Final Machina Settings:', this.settings.machine);
  }
  
  /**
   * Override default settings with any provided in the URL.
   */
  _applyQueryParameters() {
    const queryParams = new URLSearchParams(window.location.search);
    for (const [key, value] of queryParams.entries()) {
      if (['temperature', 'topP', 'topK'].includes(key)) {
        const numValue = parseFloat(value);
        this.settings.llm[key] = isNaN(numValue) ? value : numValue;
      } else if (['maxOutputTokens', 'thinkingBudget'].includes(key)) {
        const numValue = parseInt(value, 10);
        this.settings.llm[key] = isNaN(numValue) ? value : numValue;
      } else if (key === 'includeThoughts') {
        const boolValue = (value === 'true');
        this.settings.llm[key] = boolValue;
      } else if (['instructions_file'].includes(key)) {
        // Change default Machina instructions file name if received.
        this.settings.machine['instructions_file'] = value;
      } else {
        this.settings.llm[key] = value;
      }
    }
  }
  
  /**
   * Gathers and stores references to all necessary DOM elements.
   */
  _getElements() {
    this.elements = {
      dialogueWrapper: document.getElementById('dialogue-content-wrapper'),
      textarea: document.getElementById('dialogue-editor-textarea'),
      filePickerContainer: document.getElementById('file-picker-container'),
      chooseFileButton: document.getElementById('chooseFileButton'),
      tokenPopupSaveButton: document.getElementById('tokenPopupSaveButton'),
      tokenPopupCancelButton: document.getElementById('tokenPopupCancelButton'),
      loadingOverlay: document.getElementById('loading-overlay'),
      tokenPopupInput: document.getElementById('tokenPopupInput'),
    };
    
    // Make the dialogue wrapper programmatically focusable
    this.elements.dialogueWrapper.setAttribute('tabindex', '-1');
    this.elements.dialogueWrapper.style.outline = 'none';
  }
  
  /**
   * Attaches all the event listeners for the application.
   * We use arrow functions for handlers to ensure `this` refers to the class instance.
   */
  _attachEventListeners() {
    this.elements.tokenPopupSaveButton.addEventListener('click', this._handleTokenSave);
    this.elements.tokenPopupCancelButton.addEventListener('click', hideTokenPopup);
    this.elements.chooseFileButton.addEventListener('click', this._handleFilePick);
    this.elements.dialogueWrapper.addEventListener('click', this.switchToEditMode);
    this.elements.textarea.addEventListener('keydown', this._handleEditorSave);
    document.addEventListener('keydown', this._handleGlobalKeys);
    
    // Listen for custom events and browser events
    window.addEventListener('localStorageChanged', this.updateDisplayState);
    window.addEventListener('runMachineCommand', this.runLlm);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.updateDisplayState();
      }
    });
  }
  
  // --- Event Handlers & Core Logic Methods ---
  
  _handleTokenSave = () => {
    const tokenInputVal = this.elements.tokenPopupInput.value;
    if (tokenInputVal && tokenInputVal.trim()) {
      this.settings.llm.token = tokenInputVal.trim();
      console.log('Token set manually via pop-up.');
      hideTokenPopup();
      this.runLlm(); // Optionally, re-trigger the LLM run after getting the token
    } else {
      alert('Please enter a valid API token.');
    }
  };
  
  updateDisplayState = () => {
    const currentPlatoText = localStorage.getItem('multilogue');
    if (currentPlatoText && currentPlatoText.trim() !== '') {
      try {
        // Attempt to render the text as HTML.
        this.elements.dialogueWrapper.innerHTML = platoTextToPlatoHtml(currentPlatoText);
        
        // If successful, show the rendered view.
        this.elements.dialogueWrapper.style.display = 'block';
        this.elements.textarea.style.display = 'none';
        this.elements.filePickerContainer.style.display = 'none';
        this.elements.dialogueWrapper.scrollIntoView({ behavior: 'smooth', block: 'end' });
        this.elements.dialogueWrapper.focus({ preventScroll: true });
        
      } catch (e) {
        // If rendering fails, the content is likely malformed.
        console.error("Error rendering Plato text to HTML. Forcing edit mode.", e);
        
        // Put the raw text into the editor so the user can fix it.
        this.elements.textarea.value = currentPlatoText;
        
        // Show the editor view.
        this.elements.dialogueWrapper.style.display = 'none';
        this.elements.textarea.style.display = 'block';
        this.elements.filePickerContainer.style.display = 'none';
        this.elements.textarea.focus();
        
        // Alert the user that they've been put into edit mode.
        alert("The dialogue content could not be displayed and has been opened in the editor for correction.");
      }
    } else {
      // No content, show the file picker.
      this.elements.dialogueWrapper.style.display = 'none';
      this.elements.textarea.style.display = 'none';
      this.elements.filePickerContainer.style.display = 'flex';
      this.elements.dialogueWrapper.innerHTML = '';
      this.elements.textarea.value = '';
    }
  };
  
  _handleFilePick = async () => {
    try {
      const [fileHandle] = await window.showOpenFilePicker({
        types: [{
          description: 'Text Files',
          accept: { 'text/plain': ['.txt', '.md', '.text', '.plato'] },
        }]
      });
      const file = await fileHandle.getFile();
      const fileContent = await file.text();
      
      // Set the content in localStorage so it's saved.
      localStorage.setItem('multilogue', fileContent);
      
      // Replicate the old, more forgiving behavior: go directly to the editor.
      this.elements.textarea.value = fileContent;
      this.elements.dialogueWrapper.style.display = 'none';
      this.elements.filePickerContainer.style.display = 'none';
      this.elements.textarea.style.display = 'block';
      this.elements.textarea.focus();
      
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error opening file:', err);
        alert(`Error opening file: ${err.message}`);
      }
    }
  };
  
  switchToEditMode = () => {
    try {
      this.elements.textarea.value = platoHtmlToPlatoText(this.elements.dialogueWrapper.innerHTML);
      this.elements.dialogueWrapper.style.display = 'none';
      this.elements.textarea.style.display = 'block';
      this.elements.filePickerContainer.style.display = 'none';
      this.elements.textarea.focus();
    } catch (e) {
      console.error("Error converting HTML to text for editing:", e);
      alert("Could not switch to edit mode due to a content error.");
    }
  };
  
  _handleEditorSave = (event) => {
    if (event.ctrlKey && !event.shiftKey && event.key === 'Enter') {
      event.preventDefault();
      localStorage.setItem('multilogue', this.elements.textarea.value);
      this.updateDisplayState();
    }
  };
  
  _handleGlobalKeys = async (event) => {
    if (event.ctrlKey && event.shiftKey && event.key === 'Enter') {
      event.preventDefault();
      this._saveToFile();
    }
    if (event.ctrlKey && event.altKey && event.key === 'Enter') {
      event.preventDefault();
      this._saveHtmlToFile(); // New: Save as HTML
    }
    if (event.altKey && event.shiftKey) {
      event.preventDefault();
      this.runLlm();
    }
  };
  
  _saveToFile = async () => {
    const textToSave = localStorage.getItem('multilogue') || '';
    if (!textToSave.trim()) {
      alert('Dialogue is empty. Nothing to save.');
      return;
    }
    try {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: 'multilogue.txt',
        types: [{
          description: 'Text Files',
          accept: { 'text/plain': ['.txt', '.md', '.text', '.plato'] },
        }],
      });
      const writable = await fileHandle.createWritable();
      await writable.write(textToSave);
      await writable.close();
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error saving file:', err);
        alert(`Could not save file: ${err.message}`);
      }
    }
  };
  
  /**
   * Saves the dialogue's inner HTML content to a local .html file.
   */
  _saveHtmlToFile = async () => {
    const htmlToSave = this.elements.dialogueWrapper.innerHTML || '';
    if (!htmlToSave.trim()) {
      alert('Dialogue is empty. Nothing to save.');
      return;
    }
    try {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: 'multilogue.html',
        types: [{
          description: 'HTML Files',
          accept: { 'text/html': ['.html', '.htm'] },
        }],
      });
      const writable = await fileHandle.createWritable();
      await writable.write(htmlToSave);
      await writable.close();
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error saving HTML file:', err);
        alert(`Could not save HTML file: ${err.message}`);
      }
    }
  };
  
  _ensureToken = async () => {
    if (this.settings.llm.token) return true;
    
    try {
      const tokenResponse = await fetch(this.settings.machine.server + '/token/' + this.settings.machine.token, {mode: "cors"});
      if (!tokenResponse.ok) {
        throw new Error(`Server responded with status: ${tokenResponse.status}`);
      }
      const fetchedToken = (await tokenResponse.text()).trim();
      if (!fetchedToken) {
        throw new Error("Fetched token is empty.");
      }
      this.settings.llm.token = fetchedToken;
      console.log('Token fetched successfully from server.');
      return true;
    } catch (fetchError) {
      // Is it because of the debug on the local server?
      try {
        const tokenResponse = await fetch('https://localhost:8443/token/' + this.settings.machine.token, {mode: "cors"});
        if (!tokenResponse.ok) {
          throw new Error(`Server responded with status: ${tokenResponse.status}`);
        }
        const fetchedToken = (await tokenResponse.text()).trim();
        if (!fetchedToken) {
          throw new Error("Fetched token is empty.");
        }
        this.settings.llm.token = fetchedToken;
        this.settings.machine.server = 'https://localhost:8443'
        console.log(`Token fetched successfully from the debug server; server URL updated to ${this.settings.machine.server}`);
        return true;
      } catch (fetchError2) {
        console.error('Token fetch failed:', fetchError.message);
        showTokenPopup(); // Show pop-up to ask for token
        return false; // Indicate that we couldn't get a token
      }
    }
  };
  
  runLlm = async () => {
    const hasToken = await this._ensureToken();
    if (!hasToken) {
      console.log('LLM run aborted: No API token available.');
      return;
    }
    
    const htmlContent = this.elements.dialogueWrapper.innerHTML;
    if (!htmlContent || htmlContent.trim() === '') {
      alert('Dialogue is empty. Please add some content first.');
      return;
    }
    
    console.log('Preparing to send dialogue to LLM worker...');
    this.elements.loadingOverlay.style.display = 'flex';
    
    try {
      const cmjMessages = platoHtmlToCmj(htmlContent, this.settings.machine.name);
      const mpujMessages = platoHtmlToMpuj(htmlContent, this.settings.machine.name)
      
      const workerPayload = {
        config: this.settings.machine,
        settings: this.settings.llm,
        messages: mpujMessages
      };
      
      console.log('Launching LLM worker with payload:', workerPayload);
      const llmWorker = new Worker(this.settings.workerUrl);
      
      llmWorker.onmessage = (e) => {
        this.elements.loadingOverlay.style.display = 'none';
        console.log('Main thread: Message received from worker:', e.data);
        if (e.data.type === 'success') {
          this._processLlmResponse(e.data.data, cmjMessages);
        } else if (e.data.type === 'error') {
          console.error('Main thread: Error message from worker:', e.data.error);
          alert(`Worker reported an error: ${e.data.error}`);
        }
        llmWorker.terminate(); // Clean up the worker
      };
      
      llmWorker.onerror = (error) => {
        this.elements.loadingOverlay.style.display = 'none';
        console.error('Main thread: An error occurred with the worker script:', error.message, error);
        alert(`Failed to initialize or run worker: ${error.message}`);
        llmWorker.terminate(); // Clean up the worker
      };
      
      llmWorker.postMessage(workerPayload);
      console.log('Main thread: Worker launched and payload sent.');
      
    } catch (e) {
      this.elements.loadingOverlay.style.display = 'none';
      console.error('Failed to process dialogue or communicate with the worker:', e);
      alert(`Error preparing data for LLM: ${e.message}`);
    }
  };
  
  _processLlmResponse = (llmResponseData, originalCmjMessages) => {
    try {
      console.log('Worker task successful. LLM Response:', llmResponseData);
      if (!llmResponseData) {
        throw new Error('LLM response is missing message content.');
      }
      
      const responseContent = llmResponseData.content.parts;
      const regularText = responseContent
        .filter(part => !part.hasOwnProperty('thought'))
        .map(part => part.text)
        .join(' ');
      
      const desoupedText = llmSoupToText(regularText);
      console.log('Regular text:', desoupedText);
      
      const thoughtsText = responseContent
        .filter(part => part.hasOwnProperty('thought') && part.thought)
        .map(part => part.text)
        .join(' ');
      
      const desoupedThoughts = llmSoupToText(thoughtsText);
      console.log('Thoughts text:', desoupedThoughts);
      
      const newCmjMessage = {
        role: 'assistant',
        name: this.settings.machine.name,
        content: desoupedText
      };
      
      const updatedCmjMessages = [...originalCmjMessages, newCmjMessage];
      const updatedPlatoText = CmjToPlatoText(updatedCmjMessages);
      
      if (typeof updatedPlatoText !== 'string') {
        throw new Error('Failed to convert updated CMJ to PlatoText.');
      }
      
      localStorage.setItem('multilogue', updatedPlatoText);
      localStorage.setItem('thoughts', desoupedThoughts);
      
      this.updateDisplayState();
      console.log('Dialogue updated with LLM response.');
      
    } catch (processingError) {
      console.error('Error processing LLM response:', processingError);
      alert(`An error occurred while processing the LLM response: ${processingError.message}`);
    }
  };
}

// --- Application Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  const configElement = document.getElementById('machina-config');
  if (configElement) {
    // All the logic is now encapsulated in the MachineApp class.
    // We just need to create a new instance to get everything running.
    new MachineApp(configElement);
    console.log('MachineApp initialized.');
  } else {
    console.log('This is not a machine page (machina-config element not found).');
  }
});
