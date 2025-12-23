export function showTokenPopup() {
  const popup = document.getElementById('tokenPopupOverlay');
  const input = document.getElementById('tokenPopupInput');
  if (popup && input) {
    input.value = '';
    popup.style.display = 'flex';
    input.focus();
  } else {
    console.error('Token pop-up elements (tokenPopupOverlay or tokenPopupInput) not found. Ensure HTML is present.');
    alert('Error: Token input dialog is missing. Cannot proceed without a token if fetch fails.');
  }
}
export function hideTokenPopup() {
  const popup = document.getElementById('tokenPopupOverlay');
  if (popup) {
    popup.style.display = 'none';
  }
}
