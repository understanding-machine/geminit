(function () {
  // Override localStorage.setItem
  const originalSetItem = localStorage.setItem;
  localStorage.setItem = function (key, value) {
    originalSetItem.apply(this, arguments);
    window.dispatchEvent(new CustomEvent('localStorageChanged', {
      detail: {
        type: 'setItem',
        key,
        value,
        timestamp: Date.now()
      }
    }));
  };

  // Override localStorage.removeItem
  const originalRemoveItem = localStorage.removeItem;
  localStorage.removeItem = function (key) {
    originalRemoveItem.apply(this, arguments);
    window.dispatchEvent(new CustomEvent('localStorageChanged', {
      detail: {
        type: 'removeItem',
        key,
        timestamp: Date.now()
      }
    }));
  };

  // Override localStorage.clear
  const originalClear = localStorage.clear;
  localStorage.clear = function () {
    originalClear.apply(this);
    window.dispatchEvent(new CustomEvent('localStorageChanged', {
      detail: {
        type: 'clear',
        timestamp: Date.now()
      }
    }));
  };
})();
