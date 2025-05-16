// Verbesserte content.js, die Nachrichten nach IDs sortiert

// Globale Variablen
let suggestionPanel;
let lastProcessedMessageId = '';
let waitingForSuggestion = false;
let checkIntervalId = null;
let debugMode = true;

function debug(message, obj = null) {
  if (!debugMode) return;
  
  // Create timestamp in format HH:MM:SS.mmm
  const now = new Date();
  const timestamp = now.toTimeString().split(' ')[0] + '.' + 
                    String(now.getMilliseconds()).padStart(3, '0');
  
  if (obj) {
    console.log(`%c[${timestamp}][FanFix Assistant] ${message}`, 'color: #4285f4', obj);
  } else {
    console.log(`%c[${timestamp}][FanFix Assistant] ${message}`, 'color: #4285f4');
  }
}

// Initialisierungsfunktion
function initExtension() {
  debug('Initializing FanFix Chat Assistant');
  
  // Starte einen einfachen Timer
  if (checkIntervalId) clearInterval(checkIntervalId);
  
  // Wir prüfen alle 2 Sekunden auf neue Nachrichten
  checkIntervalId = setInterval(() => {
    // Prüfen, ob wir auf einer Chat-Seite sind
    const isChatPage = window.location.href.includes('fanfix.io') && 
                      (window.location.href.includes('/chat') || 
                       window.location.href.includes('/messages'));
    
    if (isChatPage) {
      // Versuche, die neueste Nachricht vom Fan zu finden
      checkForNewMessages();
    } else {
      // Wenn wir nicht auf einer Chat-Seite sind, verstecke das Panel
      if (suggestionPanel) suggestionPanel.style.display = 'none';
    }
  }, 2000);
  
  // Erstelle das Panel einmal
  createSuggestionPanel();
}

// Extrahiert die numerische ID aus einer Nachrichten-ID
function extractMessageId(message) {
  // Die ID ist im Format "message-1029552743"
  const idAttr = message.id || '';
  const matches = idAttr.match(/message-(\d+)/);
  
  if (matches && matches[1]) {
    return parseInt(matches[1], 10);
  }
  
  return 0; // Fallback, falls keine ID gefunden wird
}

// Prüft auf neue Nachrichten, sortiert nach IDs
function checkForNewMessages() {
  // Wenn wir bereits auf eine Antwort warten, nicht erneut prüfen
  if (waitingForSuggestion) return;
  
  // Finde alle "othermessage" Elemente (Nachrichten von Fans)
  const fanMessages = document.querySelectorAll('.othermessage');
  
  if (fanMessages.length === 0) {
    debug('No fan messages found yet');
    return;
  }
  
  // Konvertiere NodeList zu Array und sortiere nach IDs
  const sortedFanMessages = Array.from(fanMessages)
    .filter(msg => msg.id) // Nur Nachrichten mit IDs
    .sort((a, b) => {
      const idA = extractMessageId(a);
      const idB = extractMessageId(b);
      return idB - idA; // Absteigend sortieren (höchste zuerst)
    });
  
  if (sortedFanMessages.length === 0) {
    debug('No fan messages with valid IDs found');
    return;
  }
  
  // Hole die Nachricht mit der höchsten ID (neueste)
  const latestFanMessage = sortedFanMessages[0];
  const messageId = extractMessageId(latestFanMessage);
  
  debug('Latest fan message ID:', messageId);
  
  // Versuche, den Text zu extrahieren
  const textElement = latestFanMessage.querySelector('[data-testid="message-thread-content-ds"] .interRegular14 div');
  
  if (!textElement) {
    debug('Text element not found in the latest fan message');
    return;
  }
  
  const messageText = textElement.textContent.trim();
  
  // Wenn es eine neue Nachricht ist (basierend auf ID), verarbeite sie
  if (messageText && messageId.toString() !== lastProcessedMessageId) {
    debug('New fan message detected:', messageText);
    debug('Message ID:', messageId);
    lastProcessedMessageId = messageId.toString();
    processMessage(messageText, getRecentChatHistory());
  }
}

// Holt den aktuellen Chat-Verlauf, sortiert nach IDs
function getRecentChatHistory() {
  const chatHistory = [];
  
  // Finde alle Nachrichten
  const allMessages = document.querySelectorAll('.mymessage, .othermessage');
  
  // Konvertiere zu Array und sortiere nach IDs
  const sortedMessages = Array.from(allMessages)
    .filter(msg => msg.id) // Nur Nachrichten mit IDs
    .sort((a, b) => {
      const idA = extractMessageId(a);
      const idB = extractMessageId(b);
      return idA - idB; // Aufsteigend sortieren für chronologische Reihenfolge
    });
  
  // Nimm nur die letzten 10 Nachrichten
  const recentMessages = sortedMessages.slice(-10);
  
  // Füge sie zum Chat-Verlauf hinzu
  for (const message of recentMessages) {
    const isCreator = message.classList.contains('mymessage');
    const textElement = message.querySelector('[data-testid="message-thread-content-ds"] .interRegular14 div');
    
    if (textElement) {
      chatHistory.push({
        role: isCreator ? 'assistant' : 'user',
        content: textElement.textContent.trim()
      });
    }
  }
  
  return chatHistory;
}

// Verarbeitet eine Nachricht und holt Vorschläge
function processMessage(message, chatHistory) {
  debug('Processing message:', message);
  debug('Chat history:', chatHistory);
  
  // Zeige, dass wir auf Vorschläge warten
  waitingForSuggestion = true;
  updateSuggestionPanel('Thinking...');
  
  // Hole Vorschläge vom Hintergrund-Skript
  chrome.runtime.sendMessage({
    action: 'getSuggestions',
    message: message,
    chatHistory: chatHistory
  }, (response) => {
    debug('Received response from background script:', response);
    
    if (chrome.runtime.lastError) {
      debug('Error from background script:', chrome.runtime.lastError);
      updateSuggestionPanel('Error: ' + chrome.runtime.lastError.message);
      waitingForSuggestion = false;
      return;
    }
    
    if (response && response.suggestions) {
      displaySuggestions(response.suggestions);
    } else if (response && response.error) {
      updateSuggestionPanel('Error: ' + response.error);
    } else {
      updateSuggestionPanel('Error getting suggestions');
    }
    
    waitingForSuggestion = false;
  });
}

// Erstellt das Suggestion-Panel
function createSuggestionPanel() {
  // Wenn das Panel bereits existiert, nichts tun
  if (suggestionPanel) return;
  
  // Erstelle das Panel
  suggestionPanel = document.createElement('div');
  suggestionPanel.className = 'fanfix-suggestion-panel';
  suggestionPanel.innerHTML = `
    <div class="suggestion-header">
      <span>💬 Response Suggestions</span>
      <button class="close-btn">×</button>
    </div>
    <div class="suggestion-content">
      <p class="waiting-message">Waiting for fan messages...</p>
    </div>
  `;
  
  // Füge es zum Dokument hinzu
  document.body.appendChild(suggestionPanel);
  
  // Füge Event-Listener hinzu
  suggestionPanel.querySelector('.close-btn').addEventListener('click', () => {
    suggestionPanel.classList.toggle('minimized');
  });
  
  debug('Suggestion panel created');
}

// Aktualisiert das Suggestion-Panel
function updateSuggestionPanel(message) {
  if (!suggestionPanel) createSuggestionPanel();
  
  // Stelle sicher, dass das Panel sichtbar ist
  suggestionPanel.style.display = 'block';
  
  const content = suggestionPanel.querySelector('.suggestion-content');
  content.innerHTML = `<p class="waiting-message">${message}</p>`;
}

// Zeigt Vorschläge im Panel an
function displaySuggestions(suggestions) {
  if (!suggestionPanel) createSuggestionPanel();
  
  // Stelle sicher, dass das Panel sichtbar ist
  suggestionPanel.style.display = 'block';
  
  const content = suggestionPanel.querySelector('.suggestion-content');
  content.innerHTML = '';
  
  suggestions.forEach((suggestion) => {
    const suggestionElement = document.createElement('div');
    suggestionElement.className = 'suggestion-item';
    suggestionElement.textContent = suggestion;
    suggestionElement.addEventListener('click', () => {
      insertSuggestion(suggestion);
    });
    content.appendChild(suggestionElement);
  });
}

// Fügt einen Vorschlag in das Eingabefeld ein
function insertSuggestion(text) {
  // Finde das Eingabefeld
  const inputField = document.querySelector('[placeholder="Write a message..."]');
  
  if (inputField) {
    // Setze den Wert des Eingabefelds
    inputField.value = text;
    inputField.focus();
    
    // Trigger ein input-Event
    const inputEvent = new Event('input', { bubbles: true });
    inputField.dispatchEvent(inputEvent);
    
    debug('Suggestion inserted into input field');
  } else {
    debug('Input field not found');
  }
}

// Höre auf Nachrichten vom Popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'refresh') {
    debug('Refresh requested from popup');
    
    // Erzwinge eine neue Prüfung
    lastProcessedMessageId = '';
    checkForNewMessages();
    
    sendResponse({ status: 'refreshing' });
  }
  
  return true;
});

// Initialisiere die Extension, sobald das Dokument bereit ist
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initExtension);
} else {
  initExtension();
}