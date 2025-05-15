document.addEventListener('DOMContentLoaded', function() {
  const apiKeyInput = document.getElementById('apiKey');
  const modelNameSelect = document.getElementById('modelName');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');
  
  // Load saved settings
  chrome.storage.sync.get(['openaiApiKey', 'modelName'], function(data) {
    if (data.openaiApiKey) {
      apiKeyInput.value = data.openaiApiKey;
    }
    
    if (data.modelName) {
      modelNameSelect.value = data.modelName;
      
      // If the model isn't in the list, add it
      if (!Array.from(modelNameSelect.options).some(option => option.value === data.modelName)) {
        const option = document.createElement('option');
        option.value = data.modelName;
        option.textContent = data.modelName + ' (Custom)';
        modelNameSelect.appendChild(option);
        modelNameSelect.value = data.modelName;
      }
    }
  });
  
  // Save settings when the button is clicked
  saveBtn.addEventListener('click', function() {
    const apiKey = apiKeyInput.value.trim();
    const modelName = modelNameSelect.value;
    
    // Validate API key format
    if (!apiKey || !apiKey.startsWith('sk-')) {
      showStatus('Please enter a valid OpenAI API key starting with "sk-"', 'error');
      return;
    }
    
    // Save settings
    chrome.storage.sync.set({
      openaiApiKey: apiKey,
      modelName: modelName
    }, function() {
      showStatus('Settings saved successfully!', 'success');
    });
  });
  
  function showStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = 'status ' + type;
    statusEl.style.display = 'block';
    
    // Hide the status message after 3 seconds
    setTimeout(function() {
      statusEl.style.display = 'none';
    }, 3000);
  }
  
  // Add option to add custom model
  const addCustomOption = document.createElement('option');
  addCustomOption.value = 'custom';
  addCustomOption.textContent = '-- Add Custom Model --';
  modelNameSelect.appendChild(addCustomOption);
  
  modelNameSelect.addEventListener('change', function() {
    if (modelNameSelect.value === 'custom') {
      const customModel = prompt('Enter your custom model name:');
      if (customModel && customModel.trim()) {
        const option = document.createElement('option');
        option.value = customModel.trim();
        option.textContent = customModel.trim() + ' (Custom)';
        modelNameSelect.insertBefore(option, addCustomOption);
        modelNameSelect.value = customModel.trim();
      } else {
        modelNameSelect.value = 'gpt-3.5-turbo';
      }
    }
  });
});