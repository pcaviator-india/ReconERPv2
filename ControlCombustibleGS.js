function saveFuelEntry(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("ControlCombustible");
  
  // Ensure the order here matches your sheet headers exactly:
  // Date, Proyecto, TipoActivo, ID/Patente, Litros, KM, Nombre, User
  sheet.appendRow([
    new Date(), 
    data.proyecto, 
    data.tipoActivo, 
    data.assetId, 
    data.cantidadLitro, 
    data.kilometraje, 
    data.nombre, 
    data.userEmail
  ]);
  checkAndSendFuelAlert();
  return true;
}

function getFuelHistory() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("ControlCombustible");
  
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  // Map the data and convert Date objects to Strings
  return data.slice(1).slice(-50).map(row => {
    return row.map((cell, index) => {
      // If column is 0 (Date column), format it
      if (index === 0 && cell instanceof Date) {
        return Utilities.formatDate(cell, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
      }
      return cell;
    });
  });
}

function getFuelBalance() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Calculate Purchases from 'FuelPurchases' (Column C = index 2)
  const buySheet = ss.getSheetByName("CompraCombustible");
  let totalBought = 0;
  if (buySheet) {
    const buyData = buySheet.getDataRange().getValues();
    // Start from index 1 to skip header row
    totalBought = buyData.slice(1).reduce((sum, row) => sum + (Number(row[2]) || 0), 0);
  }
  
  // 2. Calculate Consumption from 'ControlCombustible' (Column D = index 4)
  const useSheet = ss.getSheetByName("ControlCombustible");
  let totalUsed = 0;
  if (useSheet) {
    const useData = useSheet.getDataRange().getValues();
    // Start from index 1 to skip header row
    totalUsed = useData.slice(1).reduce((sum, row) => sum + (Number(row[4]) || 0), 0);
  }
  console.log(totalBought - totalUsed);
  return {
    balance: totalBought - totalUsed,
    totalBought: totalBought,
    totalUsed: totalUsed
  };
}


function saveFuelPurchase(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("CompraCombustible");
  
  sheet.appendRow([
    new Date(), 
    data.proveedor, 
    data.litros, 
    data.factura,
    data.userName
  ]);
  
  // RE-EVALUATE BALANCE AFTER PURCHASE:
  // Calculate the new balance to see if it's back above the 200L threshold.
  const balanceData = getFuelBalance();
  const scriptProperties = PropertiesService.getScriptProperties();
  
  if (balanceData.balance > 200) {
    // If the new stock is comfortably above 200L, reset the flag to 'false'
    // so that it is fully armed to send another alert the next time it drops.
    scriptProperties.setProperty('FUEL_ALERT_SENT', 'false');
  } else {
    // If the purchase was small and the balance is still <= 200L, 
    // we keep the flag as 'true' to avoid immediately re-triggering an alert email 
    // for the same low-stock event.
    scriptProperties.setProperty('FUEL_ALERT_SENT', 'true');
  }

  return true; // Notify success
}



function checkAndSendFuelAlert() {
  const balanceData = getFuelBalance();
  const currentBalance = balanceData.balance;
  const THRESHOLD = 200;
  
  const scriptProperties = PropertiesService.getScriptProperties();
  const alertStatus = scriptProperties.getProperty('FUEL_ALERT_SENT');

  // If balance is critical and an alert hasn't been sent yet
  if (currentBalance <= THRESHOLD && alertStatus !== 'true') {
    sendFuelAlertEmail(balanceData);
    // Mark alert as sent to prevent spamming
    scriptProperties.setProperty('FUEL_ALERT_SENT', 'true');
  } else if (currentBalance > THRESHOLD) {
    // Reset the alert flag if the fuel has been refilled above the threshold
    scriptProperties.setProperty('FUEL_ALERT_SENT', 'false');
  }
}

function sendFuelAlertEmail(balanceData) {
  // RECIPIENT: Change this to the email address(es) that should receive the warning
  const emailRecipient = "ehunter@recondrilling.com"; 
  
  const subject = "⚠️ ALERTA CRÍTICA: Stock de Combustible Bajo";
  
  const htmlBody = `
    <div style="font-family: Arial, sans-serif; color: #333;">
      <h2 style="color: #d9534f;">⚠️ Alerta de Combustible</h2>
      <p>El stock de combustible ha caído por debajo del límite de seguridad establecido.</p>
      
      <div style="background-color: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #721c24;">Nivel Actual: <strong>${balanceData.balance} Litros</strong></h3>
        <p style="margin-bottom: 0;">Límite configurado: 200 Litros</p>
      </div>

      <table style="width: 100%; max-width: 400px; border-collapse: collapse; margin-top: 20px;">
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #ddd;">Total Comprado:</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${balanceData.totalBought} L</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #ddd;">Total Consumido:</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${balanceData.totalUsed} L</td>
        </tr>
      </table>
      
      <p style="margin-top: 20px;">Por favor, gestione una nueva compra en la sección de <b>Recepción de Combustible</b> a la brevedad.</p>
      
      <br>
      <hr style="border: none; border-top: 1px solid #eee;">
      <p style="font-size: 12px; color: #999;">Sistema de Control de Combustible</p>
    </div>
  `;

  SmartDispatcher({
    type: "FuelAlert",
    refId: "",
    to: emailRecipient,
    subject: subject,
    body: htmlBody,
    replyTo: "noreply@recon.cl",
    senderEmail: "noreply@recon.cl",
  });
}

function getFuelPurchaseHistory() {
  Logger.log("Started step 1");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("CompraCombustible");

  if (!sheet) return [];
  console.log("Started step 2, got sheet");
  const data = sheet.getDataRange().getValues();
  console.log("Data in console: ",data);
  const rows = data.slice(1)
    .filter(r => r[0])
    .map(r => {
      const fecha = new Date(r[0]);

      return {
        fecha: Utilities.formatDate(
          fecha,
          Session.getScriptTimeZone(),
          "dd/MM/yyyy"
        ),
        fechaISO: Utilities.formatDate(
          fecha,
          Session.getScriptTimeZone(),
          "yyyy-MM-dd"
        ),
        fechaObj: fecha,
        proveedor: r[1],
        litros: r[2],
        factura: r[3],
        usuario: r[4]
      };
    });

  // Newest first
  rows.sort((a, b) => b.fechaObj - a.fechaObj);

  // Default: last month
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

  let result = rows.filter(r => r.fechaObj >= oneMonthAgo);

  // If fewer than 10 records, show latest 10 instead
  if (result.length < 10) {
    result = rows.slice(0, 10);
  }

  console.log(JSON.stringify(result[0]));

  // Remove fechaObj before sending to browser
 const finalResult = result.map(r => ({
  fecha: r.fecha,
  fechaISO: r.fechaISO,
  proveedor: r.proveedor,
  litros: r.litros,
  factura: r.factura,
  usuario: r.usuario,
  TEST_FIELD: "VERSION_20260730"
}));

Logger.log("FINAL RETURN:");
Logger.log(JSON.stringify(finalResult[0]));

return finalResult;
}

function getFuelPurchaseHistoryTest() {

  Logger.log("START");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log("Spreadsheet OK");

  const sheet = ss.getSheetByName("CompraCombustible");
  Logger.log("Sheet OK: " + sheet.getName());

  const range = sheet.getDataRange();
  Logger.log("Range rows: " + range.getNumRows());

  const data = range.getValues();
  Logger.log("Values loaded: " + data.length);

  return [];
}