

function getAzureGraphCredentials_() {
  const props = PropertiesService.getScriptProperties();
  const creds = {
    clientId: String(props.getProperty('AZURE_CLIENT_ID') || props.getProperty('GRAPH_CLIENT_ID') || '').trim(),
    tenantId: String(props.getProperty('AZURE_TENANT_ID') || props.getProperty('GRAPH_TENANT_ID') || '').trim(),
    clientSecret: String(props.getProperty('AZURE_CLIENT_SECRET') || props.getProperty('GRAPH_CLIENT_SECRET') || '').trim(),
  };

  if (!creds.clientId || !creds.tenantId || !creds.clientSecret) {
    throw new Error('Missing Microsoft Graph credentials. Set AZURE_CLIENT_ID, AZURE_TENANT_ID, and AZURE_CLIENT_SECRET in Script Properties.');
  }

  return creds;
}

function getCurrentAzureUserEmail_() {
  const email = String(Session.getActiveUser().getEmail() || '').trim();
  if (!email) {
    throw new Error('Current user email is unavailable in this deployment.');
  }
  return email;
}

function getWebAppUserEmail_(payload) {
  const email = String(
    (payload && payload.currentUserEmail) ||
      (payload && payload.userEmail) ||
      ''
  ).trim();

  if (!email) {
    throw new Error('Web app user email is missing. Please sign in through the ERP sidebar before sending.');
  }

  return email;
}

// Wrapper function designed specifically to feed data back clean to the HTML UI
function getUiLastReceivedEmail(targetUserEmail) {
  try {
    const accessToken = getMicrosoftGraphToken(getAzureGraphCredentials_());
    const graphEndpoint = `https://graph.microsoft.com/v1.0/users/${targetUserEmail}/messages?$top=1&$select=subject,from,receivedDateTime&$orderby=receivedDateTime desc`;

    const options = {
      'method': 'get',
      'headers': {
        'Authorization': 'Bearer ' + accessToken,
        'Accept': 'application/json'
      },
      'muteHttpExceptions': true
    };

    const response = UrlFetchApp.fetch(graphEndpoint, options);
    const responseCode = response.getResponseCode();
    const responseBody = JSON.parse(response.getContentText());

    if (responseCode === 200 && responseBody.value && responseBody.value.length > 0) {
      const latestEmail = responseBody.value[0];
      return {
        success: true,
        subject: latestEmail.subject,
        from: latestEmail.from.emailAddress.address,
        receivedAt: latestEmail.receivedDateTime
      };
    } else {
      return {
        success: false,
        error: responseBody.error ? responseBody.error.message : 'No emails found in this mailbox.'
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error.toString()
    };
  }
}


function testGetLastReceivedEmail() {
  // The email address of the inbox you want to look at
  const targetUserEmail = 'jkhatri@recondrilling.com'; 

  try {
    Logger.log('Fetching access token from Microsoft...');
    const accessToken = getMicrosoftGraphToken(getAzureGraphCredentials_());
    Logger.log('Access token retrieved successfully.');

    // Endpoint to get messages, sorted by received date (newest first), limiting to 1 result
    const graphEndpoint = `https://graph.microsoft.com/v1.0/users/${targetUserEmail}/messages?$top=1&$select=subject,from,receivedDateTime&$orderby=receivedDateTime desc`;

    const options = {
      'method': 'get',
      'headers': {
        'Authorization': 'Bearer ' + accessToken,
        'Accept': 'application/json'
      },
      'muteHttpExceptions': true
    };

    Logger.log(`Fetching the latest email for: ${targetUserEmail}...`);
    const response = UrlFetchApp.fetch(graphEndpoint, options);
    const responseCode = response.getResponseCode();
    const responseBody = JSON.parse(response.getContentText());

    if (responseCode === 200) {
      if (responseBody.value && responseBody.value.length > 0) {
        const latestEmail = responseBody.value[0];
        
        Logger.log('==================================================');
        Logger.log('SUCCESS! Successfully read from Microsoft Graph.');
        Logger.log('==================================================');
        Logger.log('Subject: ' + latestEmail.subject);
        Logger.log('From: ' + latestEmail.from.emailAddress.address);
        Logger.log('Received At: ' + latestEmail.receivedDateTime);
        Logger.log('==================================================');
      } else {
        Logger.log('Connected successfully, but the inbox appears to be completely empty.');
      }
    } else {
      Logger.log('API Call Failed with status: ' + responseCode);
      Logger.log('Error Details: ' + JSON.stringify(responseBody, null, 2));
    }

  } catch (error) {
    Logger.log('An error occurred: ' + error.toString());
  }
}

function testSendEmailViaGraph(payload) {
  try {
    const creds = getAzureGraphCredentials_();
    const senderEmail = getWebAppUserEmail_(payload);
    const toEmail = String(payload && payload.to ? payload.to : '').trim();
    const subject = String(payload && payload.subject ? payload.subject : '').trim();
    const body = String(payload && payload.body ? payload.body : '').trim();
    const cc = Array.isArray(payload && payload.cc) ? payload.cc : [];
    const bcc = Array.isArray(payload && payload.bcc) ? payload.bcc : [];

    if (!toEmail) throw new Error('Recipient email is required.');
    if (!subject) throw new Error('Subject is required.');
    if (!body) throw new Error('Body is required.');

    const accessToken = getMicrosoftGraphToken(creds);
    const graphEndpoint = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`;

    const messagePayload = {
      message: {
        subject: subject,
        body: {
          contentType: 'HTML',
          content: body,
        },
        toRecipients: [{ emailAddress: { address: toEmail } }],
        ccRecipients: cc.filter(Boolean).map(function (email) {
          return { emailAddress: { address: String(email).trim() } };
        }),
        bccRecipients: bcc.filter(Boolean).map(function (email) {
          return { emailAddress: { address: String(email).trim() } };
        }),
      },
      saveToSentItems: true,
    };

    const response = UrlFetchApp.fetch(graphEndpoint, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(messagePayload),
      headers: {
        Authorization: 'Bearer ' + accessToken,
        Accept: 'application/json',
      },
      muteHttpExceptions: true,
    });

    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode === 202) {
      return {
        success: true,
        sender: senderEmail,
        to: toEmail,
        subject: subject,
        responseCode: responseCode,
        message: 'Graph sendMail accepted the message.',
      };
    }

    return {
      success: false,
      sender: senderEmail,
      to: toEmail,
      subject: subject,
      responseCode: responseCode,
      error: responseText,
    };
  } catch (error) {
    return {
      success: false,
      error: error.toString(),
    };
  }
}

/**
 * TEMP DIAGNOSTIC helpers: JSON parse + token role decode + Graph call wrapper.
 */
function parseGraphBodyForTest_(resp) {
  try { return JSON.parse(resp.getContentText() || '{}'); } catch (e) { return {}; }
}

/**
 * Helper function to authenticate and get OAuth2 Token via Client Credentials Grant
 */
function getMicrosoftGraphToken(creds) {
  const tokenUrl = `https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/token`;
  
  const payload = {
    'client_id': creds.clientId,
    'scope': 'https://graph.microsoft.com/.default',
    'client_secret': creds.clientSecret,
    'grant_type': 'client_credentials'
  };

  const options = {
    'method': 'post',
    'contentType': 'application/x-www-form-urlencoded',
    'payload': payload,
    'muteHttpExceptions': true
  };

  const response = UrlFetchApp.fetch(tokenUrl, options);
  const json = JSON.parse(response.getContentText());

  if (json.access_token) {
    return json.access_token;
  } else {
    throw new Error('Authentication Failed: ' + (json.error_description || response.getContentText()));
  }
}

/**
 * TEMP DIAGNOSTIC helpers for the Mail.ReadWrite capability test.
 * Safe: only temporary drafts are created and immediately deleted. Never sends.
 */
function decodeTokenRolesForTest_(token) {
  try {
    var parts = String(token).split('.');
    if (parts.length < 2) return [];
    var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var payload = JSON.parse(Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString());
    return (payload && Array.isArray(payload.roles)) ? payload.roles : [];
  } catch (e) { return []; }
}

function graphCallForTest_(token, method, url, body) {
  var headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' };
  var opts = { method: method, headers: headers, muteHttpExceptions: true };
  if (body !== undefined && body !== null) {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(body);
  }
  var resp = UrlFetchApp.fetch(url, opts);
  var code = resp.getResponseCode();
  var parsed = parseGraphBodyForTest_(resp);
  var errMsg = (parsed && parsed.error && parsed.error.message) ? String(parsed.error.message) : '';
  return { code: code, body: parsed, errMsg: errMsg, raw: resp.getContentText().slice(0, 300) };
}

function graphMimeCallForTest_(token, url, mimeMessage) {
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'text/plain',
    payload: Utilities.base64Encode(mimeMessage),
    headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
    muteHttpExceptions: true
  });
  var parsed = parseGraphBodyForTest_(resp);
  var errMsg = (parsed && parsed.error && parsed.error.message) ? String(parsed.error.message) : '';
  return { code: resp.getResponseCode(), body: parsed, errMsg: errMsg, raw: resp.getContentText().slice(0, 300) };
}

/**
 * TEMPORARY DIAGNOSTIC - Mail.ReadWrite capability test (safe, non-destructive).
 * Called from AzureTest.html panel. Creates temporary DRAFTS only, then deletes.
 * @param {string} mailbox Target mailbox to test.
 */
function testMailReadWriteCapability(mailbox) {
  var target = String(mailbox || '').trim();
  var steps = [];
  var push = function (name, perm, ok, code, detail) {
    steps.push({ name: name, permission: perm, ok: !!ok, httpCode: code || 0, detail: String(detail || '') });
  };
  if (!target) return { success: false, summary: 'Target mailbox required.', tokenRoles: [], steps: steps };
  var token = '';
  try { token = getMicrosoftGraphToken(getAzureGraphCredentials_()); }
  catch (e) {
    push('Acquire app token', 'n/a', false, 0, String((e && e.message) || e));
    return { success: false, summary: 'Token failed: ' + e, tokenRoles: [], steps: steps };
  }
  var roles = decodeTokenRolesForTest_(token);
  push('Acquire app token', 'n/a', true, 0, 'Roles: ' + (roles.length ? roles.join(', ') : '(none)'));
  var mbox = encodeURIComponent(target);
  var base = 'https://graph.microsoft.com/v1.0/users/' + mbox;
  var r1 = graphCallForTest_(token, 'get', base + '/messages?$top=1&$select=id,subject');
  var anchorId = '';
  if (r1.code === 200) {
    var items = (r1.body && r1.body.value) || [];
    if (items.length && items[0].id) anchorId = String(items[0].id);
    push('List 1 message', 'Mail.Read', true, 200, items.length ? ('Found: ' + (items[0].subject || '(no subj)')) : 'Readable but empty; reply step skipped.');
  } else {
    push('List 1 message', 'Mail.Read', false, r1.code, r1.errMsg || r1.raw);
    return { success: false, summary: 'READ failed - Mail.Read missing.', tokenRoles: roles, steps: steps };
  }
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  var r2 = graphCallForTest_(token, 'post', base + '/messages', {
    subject: '[Recon TEMP] ReadWrite check ' + stamp,
    body: { contentType: 'Text', content: 'Temp draft, never sent, deleted immediately.' },
    toRecipients: [{ emailAddress: { address: target } }]
  });
  var draftId = (r2.body && r2.body.id) ? String(r2.body.id) : '';
  if ((r2.code === 201) && draftId) {
    push('Create draft', 'Mail.ReadWrite', true, 201, 'Draft ' + draftId.slice(0, 32) + '...');
  } else {
    push('Create draft', 'Mail.ReadWrite', false, r2.code, r2.errMsg || r2.raw);
    return { success: false, summary: 'CREATE failed - Mail.ReadWrite missing.', tokenRoles: roles, steps: steps };
  }
  var r3 = graphCallForTest_(token, 'patch', base + '/messages/' + encodeURIComponent(draftId), { categories: ['ReconTempTest'] });
  push('Update draft', 'Mail.ReadWrite', r3.code === 200, r3.code, r3.code === 200 ? 'Tagged, unsent.' : (r3.errMsg || r3.raw));
  if (anchorId) {
    var r4 = graphCallForTest_(token, 'post', base + '/messages/' + encodeURIComponent(anchorId) + '/createReply', null);
    var replyId = (r4.body && r4.body.id) ? String(r4.body.id) : '';
    if ((r4.code === 201 || r4.code === 200) && replyId) {
      push('createReply draft (not sent)', 'Mail.ReadWrite', true, r4.code, 'Reply draft in thread.');
      var r4b = graphCallForTest_(token, 'delete', base + '/messages/' + encodeURIComponent(replyId), null);
      push('Delete reply draft', 'Mail.ReadWrite', r4b.code === 204, r4b.code, r4b.code === 204 ? 'Cleaned.' : (r4b.errMsg || r4b.raw));
    } else {
      push('createReply draft (not sent)', 'Mail.ReadWrite', false, r4.code, r4.errMsg || r4.raw);
    }
  } else {
    push('createReply draft (not sent)', 'Mail.ReadWrite', true, 0, 'Skipped - empty mailbox.');
  }
  var r5 = graphCallForTest_(token, 'delete', base + '/messages/' + encodeURIComponent(draftId), null);
  push('Delete temp draft', 'Mail.ReadWrite', r5.code === 204, r5.code, r5.code === 204 ? 'Cleaned.' : (r5.errMsg || r5.raw));
  var fails = steps.filter(function (s) { return !s.ok; });
  return {
    success: fails.length === 0,
    summary: fails.length === 0 ? 'Mail.ReadWrite AVAILABLE for ' + target + ' - all passed, nothing sent.'
      : 'FAILED at: ' + fails.map(function (s) { return s.name; }).join(', '),
    tokenRoles: roles,
    steps: steps
  };
}

function testSendThreadSeed(params) {
  var steps = [];
  var push = function (n, p, ok, c, d) {
    steps.push({ name: n, permission: p, ok: !!ok, httpCode: c || 0, detail: String(d || '') });
  };
  var mailbox = String((params && params.mailbox) || '').trim();
  var sender = String((params && (params.sender || params.currentUserEmail)) || '').trim() || mailbox;
  var tag = 'QT-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  if (!mailbox) return { success: false, summary: 'Mailbox required.', threadTag: tag, steps: steps };
  var token = '';
  try { token = getMicrosoftGraphToken(getAzureGraphCredentials_()); }
  catch (e) {
    push('Acquire app token', 'n/a', false, 0, String((e && e.message) || e));
    return { success: false, summary: 'Token failed.', threadTag: tag, steps: steps };
  }
  push('Acquire app token', 'n/a', true, 0, 'OK');
  var seedSubject = '[Recon TEMP Thread] ' + tag + ' seed';
  var s1 = graphCallForTest_(token, 'post', 'https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(sender) + '/sendMail', {
    message: {
      subject: seedSubject,
      body: { contentType: 'Text', content: 'Seed for threading test ' + tag + '. After you RECEIVE it, run Step 2 with this tag.' },
      toRecipients: [{ emailAddress: { address: mailbox } }]
    },
    saveToSentItems: true
  });
  if (s1.code !== 202) {
    push('Send seed email', 'Mail.Send', false, s1.code, s1.errMsg || s1.raw);
    return { success: false, summary: 'Seed send failed.', threadTag: tag, steps: steps };
  }
  push('Send seed email', 'Mail.Send', true, 202, 'Subject: ' + seedSubject);
  return { success: true, summary: 'Seed sent. Wait until you RECEIVE it, then run Step 2.', threadTag: tag, seedSubject: seedSubject, steps: steps };
}


/**
 * TEMP DIAGNOSTIC STEP 2 - find seed by tag, send MIME threaded reply, verify.
 */
function testSendThreadReply(params) {
  var steps = [];
  var push = function (name, perm, ok, code, detail) {
    steps.push({ name: name, permission: perm, ok: !!ok, httpCode: code || 0, detail: String(detail || '') });
  };
  var mailbox = String((params && params.mailbox) || '').trim();
  var sender = String((params && (params.sender || params.currentUserEmail)) || '').trim() || mailbox;
  var tag = String((params && (params.threadTag || params.tag)) || '').trim();
  if (!mailbox) return { success: false, summary: 'Mailbox required.', threadTag: tag, steps: steps };
  if (!tag) return { success: false, summary: 'Thread tag required - run Step 1 first.', threadTag: tag, steps: steps };
  var token = '';
  try { token = getMicrosoftGraphToken(getAzureGraphCredentials_()); }
  catch (e) {
    push('Acquire app token', 'n/a', false, 0, String((e && e.message) || e));
    return { success: false, summary: 'Token failed.', threadTag: tag, steps: steps };
  }
  push('Acquire app token', 'n/a', true, 0, 'OK');
  var mbox = encodeURIComponent(mailbox);
  var sbox = encodeURIComponent(sender);
  var base = 'https://graph.microsoft.com/v1.0/users/' + mbox;
  // User already confirmed receipt - short retries only.
  var senderBase = 'https://graph.microsoft.com/v1.0/users/' + sbox;
  var found = null;
  var foundMailbox = '';
  for (var attempt = 1; attempt <= 4; attempt++) {
    // Prefer the sender's sent copy so Graph can create a native reply in that mailbox.
    var boxes = [senderBase];
    if (base !== senderBase) boxes.push(base);
    for (var b = 0; b < boxes.length && !found; b++) {
      var q = boxes[b] + "/messages?$filter=contains(subject,'" + tag + "')" +
        '&$orderby=createdDateTime desc&$top=10&$select=id,subject,conversationId,internetMessageId,receivedDateTime,createdDateTime';
      var r = graphCallForTest_(token, 'get', q, null);
      if (r.code === 200 && r.body && r.body.value) {
        var vals = r.body.value;
        for (var i = 0; i < vals.length; i++) {
          if (String(vals[i].subject || '').indexOf(tag) !== -1) {
            found = vals[i];
            foundMailbox = boxes[b];
            break;
          }
        }
      }
      // Outlook message filters can return an empty 200 while mailbox indexing catches up.
      // Fall back to a bounded recent-message scan and match the subject locally.
      if (!found) {
        var recent = boxes[b] + '/messages?$orderby=createdDateTime desc&$top=50' +
          '&$select=id,subject,conversationId,internetMessageId,receivedDateTime,createdDateTime';
        var rr = graphCallForTest_(token, 'get', recent, null);
        if (rr.code === 200 && rr.body && rr.body.value) {
          var recentVals = rr.body.value;
          for (var ri = 0; ri < recentVals.length; ri++) {
            if (String(recentVals[ri].subject || '').indexOf(tag) !== -1) {
              found = recentVals[ri];
              foundMailbox = boxes[b];
              break;
            }
          }
        }
      }
    }
    if (found) break;
    if (attempt < 4) Utilities.sleep(8000);
  }
  if (!found) {
    push('Find seed (search)', 'Mail.Read', false, 200, 'Seed with tag ' + tag + ' not found via Graph search.');
    return { success: false, summary: 'Seed not found via Graph search.', threadTag: tag, steps: steps };
  }
  var anchorConv = String(found.conversationId || '');
  var anchorMid = String(found.internetMessageId || '');
  push('Find seed (search)', 'Mail.Read', true, 200, 'conversationId=' + anchorConv.slice(0, 32) + '...');
  var seedSubject = String(found.subject || ('[Recon TEMP Thread] ' + tag + ' seed'));
  var replySubject = (/^re:/i.test(seedSubject)) ? seedSubject : 'Re: ' + seedSubject;
  var mime = [
    'To: ' + mailbox,
    'Subject: ' + replySubject,
    'In-Reply-To: ' + anchorMid,
    'References: ' + anchorMid,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    'Threaded reply for ' + tag + ' (MIME headers reference seed).'
  ].join('\r\n');
  var s3 = graphMimeCallForTest_(token, senderBase + '/sendMail', mime);
  if (s3.code !== 202) {
    push('Send threaded reply', 'Mail.Send', false, s3.code, s3.errMsg || s3.raw);
    return { success: false, summary: 'Reply send failed.', threadTag: tag, steps: steps };
  }
  push('Send threaded reply', 'Mail.Send', true, 202, 'MIME reply sent with In-Reply-To/References.');
  Utilities.sleep(10000);
  var reply = null;
  for (var a2 = 1; a2 <= 8; a2++) {
    var q2 = base + "/messages?$filter=contains(subject,'" + tag + "')" +
      '&$orderby=createdDateTime desc&$top=10&$select=id,subject,conversationId,receivedDateTime,createdDateTime';
    var r2 = graphCallForTest_(token, 'get', q2, null);
    if (r2.code === 200 && r2.body && r2.body.value && r2.body.value.length >= 2) {
      var vs = r2.body.value;
      for (var j = 0; j < vs.length; j++) {
        if (String(vs[j].subject || '').indexOf('Re:') === 0) { reply = vs[j]; break; }
      }
      if (reply) break;
    }
    if (a2 < 8) Utilities.sleep(10000);
  }
  if (!reply) {
    push('Verify same conversation', 'Mail.Read', false, 200, 'Reply not yet visible - check mailbox manually.');
    return { success: false, summary: 'Reply not yet visible - verify manually.', threadTag: tag, anchor: found, steps: steps };
  }
  var same = String(reply.conversationId || '') === anchorConv && !!anchorConv;
  push('Verify same conversation', 'Mail.Read', same, 200,
    same ? 'MATCH: both share conversationId.' : 'MISMATCH: seed=' + anchorConv.slice(0, 24) + ' reply=' + String(reply.conversationId || '').slice(0, 24));
  var fails = steps.filter(function (s) { return !s.ok; });
  return {
    success: fails.length === 0,
    summary: fails.length === 0 ? 'Threading WORKS with current grants - reply shares conversationId.'
      : 'Threading check issues at: ' + fails.map(function (s) { return s.name; }).join(', '),
    threadTag: tag,
    seedConversationId: anchorConv,
    replyConversationId: String(reply.conversationId || ''),
    steps: steps
  };
}


