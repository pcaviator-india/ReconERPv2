/**
 * Updates a user's PIN after validating their current PIN.
 *
 * @param {string} userIdentifier User ID or Email
 * @param {string} oldPin Current PIN
 * @param {string} newPin New PIN
 * @return {{success:boolean,message:string}}
 */
function updateUserPin(userIdentifier, oldPin, newPin) {

  try {

    if (!userIdentifier || !oldPin || !newPin) {
      return {
        success: false,
        message: "Missing required fields."
      };
    }

    oldPin = String(oldPin).trim();
    newPin = String(newPin).trim();
    userIdentifier = String(userIdentifier).trim().toLowerCase();

    if (!/^\d{4}$/.test(oldPin)) {
      return {
        success: false,
        message: "Current PIN must contain exactly 4 digits."
      };
    }

    if (!/^\d{4}$/.test(newPin)) {
      return {
        success: false,
        message: "New PIN must contain exactly 4 digits."
      };
    }

    if (oldPin === newPin) {
      return {
        success: false,
        message: "New PIN must be different from your current PIN."
      };
    }

    const sheet = SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName("Users");

    if (!sheet) {
      return {
        success: false,
        message: "Users sheet not found."
      };
    }

    const data = sheet.getDataRange().getValues();

    let row = -1;

    for (let i = 1; i < data.length; i++) {

      const userId = String(data[i][0]).trim().toLowerCase();
      const email = String(data[i][3]).trim().toLowerCase();

      if (userId === userIdentifier || email === userIdentifier) {
        row = i;
        break;
      }

    }

    if (row === -1) {
      return {
        success: false,
        message: "User not found."
      };
    }

    const currentPin = String(data[row][1]).trim();

    if (currentPin !== oldPin) {
      return {
        success: false,
        message: "Current PIN is incorrect."
      };
    }

    sheet.getRange(row + 1, 2).setValue(newPin);

    return {
      success: true,
      message: "PIN updated successfully."
    };

  } catch (err) {

    return {
      success: false,
      message: err.message
    };

  }

}