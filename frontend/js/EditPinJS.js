// ============================================================================
// Edit PIN Module
// ============================================================================

window.editPinModule = {

  initialized: false,

  //--------------------------------------------------------------------------
  // Module Initialization
  //--------------------------------------------------------------------------

  init: function () {

    if (!this.initialized) {
      this.setupEventListeners();
      this.initialized = true;
    }

    this.loadUserInfo();
  },

  //--------------------------------------------------------------------------
  // Event Listeners
  //--------------------------------------------------------------------------

  setupEventListeners: function () {

    const saveBtn = document.getElementById('savePinBtn');
    const currentPinInput = document.getElementById('currentPin');
    const newPinInput = document.getElementById('newPin');
    const pinError = document.getElementById('pinError');

    if (!saveBtn || !currentPinInput || !newPinInput || !pinError) {
      console.warn("Edit PIN module: Required HTML elements not found.");
      return;
    }

    // Remove invalid state while typing
    [currentPinInput, newPinInput].forEach(input => {

      input.addEventListener('input', () => {

        pinError.style.display = 'none';
        newPinInput.classList.remove('is-invalid');

        const currentFilled = currentPinInput.value.length > 0;
        const newFilled = newPinInput.value.length === 4;

        saveBtn.disabled = !(currentFilled && newFilled);

      });

    });

    saveBtn.addEventListener('click', () => {
      this.savePinChange();
    });

  },

  //--------------------------------------------------------------------------
  // Load User
  //--------------------------------------------------------------------------

  loadUserInfo: function () {

    const userData = JSON.parse(localStorage.getItem("recon_user_secure"));

    if (!userData) return;

    const currentInput = document.getElementById('currentPin');
    const newInput = document.getElementById('newPin');
    const saveBtn = document.getElementById('savePinBtn');

    if (currentInput) currentInput.value = "";
    if (newInput) newInput.value = "";
    if (saveBtn) saveBtn.disabled = true;

  },

  //--------------------------------------------------------------------------
  // Open Modal
  //--------------------------------------------------------------------------

  openModal: function () {

    this.init();
    this.clearPinFields();

    const modalEl = document.getElementById('editPinModal');

    if (modalEl && typeof bootstrap !== "undefined") {

      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.show();

    }

  },

  //--------------------------------------------------------------------------
  // Close Modal
  //--------------------------------------------------------------------------

  closeModal: function () {

    const modalEl = document.getElementById('editPinModal');

    if (modalEl && typeof bootstrap !== "undefined") {

      const modal = bootstrap.Modal.getInstance(modalEl);

      if (modal) {
        modal.hide();
      }

    }

  },

  //--------------------------------------------------------------------------
  // Save PIN
  //--------------------------------------------------------------------------

savePinChange: function () {

    const currentPin = document.getElementById("currentPin").value.trim();
    const newPin = document.getElementById("newPin").value.trim();

    const saveBtn = document.getElementById("savePinBtn");
    const spinner = document.getElementById("savePinSpinner");

    const userData = JSON.parse(localStorage.getItem("recon_user_secure"));

    if (!userData) {
        alert("Your session has expired.");
        window.reconLogout();
        return;
    }

    if (!/^\d{4}$/.test(currentPin)) {
        this.showError("Please enter your current 4-digit PIN.");
        return;
    }

    if (!/^\d{4}$/.test(newPin)) {
        this.showError("New PIN must contain exactly 4 digits.");
        return;
    }

    if (currentPin === newPin) {
        this.showError("New PIN must be different from your current PIN.");
        return;
    }

    console.log({
        saveBtn,
        spinner
    });

    saveBtn.disabled = true;
    if (spinner) {
          spinner.classList.remove("d-none");
      } else {
          console.warn("savePinSpinner not found.");
      }

    google.script.run

        .withSuccessHandler((result) => {

            spinner.classList.add("d-none");

            if (!result.success) {

                saveBtn.disabled = false;
                this.showError(result.message);

                return;
            }

            alert("PIN changed successfully.\n\nPlease log in again using your new PIN.");

            this.closeModal();

            window.reconLogout();

        })

        .withFailureHandler((err) => {

            if (spinner) {
                spinner.classList.add("d-none");
            }    
            saveBtn.disabled = false;

            console.error(err);

            this.showError("Unable to update your PIN. Please try again.");

        })

        .updateUserPin(
            userData.email,
            currentPin,
            newPin
        );

},

  //--------------------------------------------------------------------------
  // Error Display
  //--------------------------------------------------------------------------

  showError: function (message) {

    const pinError = document.getElementById('pinError');
    const newInput = document.getElementById('newPin');

    if (pinError) {

      pinError.textContent = message;
      pinError.style.display = 'block';

    }

    if (newInput) {
      newInput.classList.add('is-invalid');
    }

  },

  //--------------------------------------------------------------------------
  // Clear Form
  //--------------------------------------------------------------------------

  clearPinFields: function () {

    const currentInput = document.getElementById('currentPin');
    const newInput = document.getElementById('newPin');
    const saveBtn = document.getElementById('savePinBtn');
    const pinError = document.getElementById('pinError');

    if (currentInput) currentInput.value = "";
    if (newInput) {
      newInput.value = "";
      newInput.classList.remove("is-invalid");
    }

    if (pinError) {
      pinError.style.display = "none";
      pinError.textContent = "";
    }

    if (saveBtn) saveBtn.disabled = true;

  }

};

// ============================================================================
// Main App Entry Point (same pattern as Products module)
// ============================================================================

window.initEditPinModule = function () {
  window.editPinModule.init();
};
