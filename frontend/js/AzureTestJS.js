function resetSendUi() {
    const sendBtn = document.getElementById('sendBtn');
    const sendStatusMessage = document.getElementById('sendStatusMessage');
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
    if (sendStatusMessage) {
      sendStatusMessage.classList.add('hidden');
    }
  }

  function setSendLoading(isLoading) {
    const sendBtn = document.getElementById('sendBtn');
    const sendStatusMessage = document.getElementById('sendStatusMessage');
    if (sendBtn) {
      sendBtn.disabled = isLoading;
      sendBtn.classList.toggle('opacity-50', isLoading);
      sendBtn.classList.toggle('cursor-not-allowed', isLoading);
    }
    if (sendStatusMessage) {
      sendStatusMessage.classList.toggle('hidden', !isLoading);
    }
  }

  function renderSendResult(response) {
    const sendResultCard = document.getElementById('sendResultCard');
    const sendResultSender = document.getElementById('sendResultSender');
    const sendResultTo = document.getElementById('sendResultTo');
    const sendResultSubject = document.getElementById('sendResultSubject');
    const sendResultStatus = document.getElementById('sendResultStatus');

    if (!sendResultCard || !sendResultSender || !sendResultTo || !sendResultSubject || !sendResultStatus) {
      return;
    }

    sendResultSender.innerText = response.sender || '-';
    sendResultTo.innerText = response.to || '-';
    sendResultSubject.innerText = response.subject || '-';
    sendResultStatus.innerText = response.success
      ? `Success (${response.responseCode || '202'}) - ${response.message || 'Message accepted by Graph.'}`
      : `Failed (${response.responseCode || 'n/a'}) - ${response.error || 'Unknown error'}`;
    sendResultCard.classList.remove('hidden');
  }

  function sendTestEmail() {
    const to = document.getElementById('sendToInput').value.trim();
    const subject = document.getElementById('sendSubjectInput').value.trim();
    const body = document.getElementById('sendBodyInput').value.trim();
    const currentUserEmail = (window.currentUser && window.currentUser.email)
      || JSON.parse(localStorage.getItem('recon_user_secure') || '{}').email
      || '';

    if (!to || !subject || !body) {
      alert('Please fill To, Subject, and Body.');
      return;
    }

    if (!currentUserEmail) {
      alert('ERP user email is missing. Please log in through the sidebar first.');
      return;
    }

    setSendLoading(true);

    google.script.run
      .withSuccessHandler(function(response) {
        setSendLoading(false);
        renderSendResult(response || {});
        if (response && response.success) {
          alert('Graph send test succeeded.');
        } else {
          alert('Graph send test failed: ' + ((response && response.error) || 'Unknown error'));
        }
      })
      .withFailureHandler(function(err) {
        setSendLoading(false);
        alert('Critical connection failure: ' + err.message);
      })
      .testSendEmailViaGraph({
        to: to,
        subject: subject,
        body: body,
        currentUserEmail: currentUserEmail,
        cc: [],
        bcc: []
      });
  }

  function loadLastEmail() {
    const email = document.getElementById('emailInput').value;
    const fetchBtn = document.getElementById('fetchBtn');
    const statusMessage = document.getElementById('statusMessage');
    const resultCard = document.getElementById('resultCard');

    if (!email) {
      alert('Please enter a valid email address.');
      return;
    }

    // UI Feedback: Loading state
    fetchBtn.disabled = true;
    fetchBtn.classList.add('opacity-50', 'cursor-not-allowed');
    statusMessage.classList.remove('hidden');
    resultCard.classList.add('hidden');

    // Call the background Google Apps Script function asynchronously
    google.script.run
      .withSuccessHandler(function(response) {
        // UI Feedback: Reset loading state
        fetchBtn.disabled = false;
        fetchBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        statusMessage.classList.add('hidden');

        if (response.success) {
          document.getElementById('emailSubject').innerText = response.subject;
          document.getElementById('emailFrom').innerText = response.from;
          document.getElementById('emailTime').innerText = response.receivedAt;
          resultCard.classList.remove('hidden');
        } else {
          alert('Error: ' + response.error);
        }
      })
      .withFailureHandler(function(err) {
        fetchBtn.disabled = false;
        fetchBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        statusMessage.classList.add('hidden');
        alert('Critical connection failure: ' + err.message);
      })
      .getUiLastReceivedEmail(email); // Pass user input to backend
  }

  // ============================================================
  // Mail.ReadWrite capability test (temporary diagnostic)
  // ============================================================

  function escHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Prefills the test mailbox with the signed-in ERP user when available.
  function prefillReadWriteMailbox() {
    const input = document.getElementById('rwMailboxInput');
    if (!input || input.value) return;
    let email = '';
    try {
      email = (window.currentUser && window.currentUser.email)
        || JSON.parse(localStorage.getItem('recon_user_secure') || '{}').email
        || '';
    } catch (e) { /* ignore parse errors, leave blank */ }
    if (email) input.value = email;
  }

  function renderReadWriteResult(report) {
    report = report || {};
    const card = document.getElementById('rwResultCard');
    const summary = document.getElementById('rwSummary');
    const roles = document.getElementById('rwRoles');
    const tbody = document.getElementById('rwStepRows');
    if (!card || !summary || !roles || !tbody) return;

    const ok = !!report.success;
    summary.innerText = report.summary || (ok ? 'Mail.ReadWrite appears available.' : 'Mail.ReadWrite test failed.');
    summary.className = 'text-sm font-semibold mb-2 ' + (ok ? 'text-green-700' : 'text-red-600');

    const roleList = Array.isArray(report.tokenRoles) ? report.tokenRoles : [];
    roles.innerText = 'Token granted roles: ' + (roleList.length ? roleList.join(', ') : '(none reported)');

    tbody.innerHTML = '';
    (Array.isArray(report.steps) ? report.steps : []).forEach(function (s) {
      const tr = document.createElement('tr');
      const statusHtml = s.ok
        ? '<span class="font-semibold text-green-700">PASS</span>' + (s.httpCode ? ' (' + s.httpCode + ')' : '')
        : '<span class="font-semibold text-red-600">FAIL</span>' + (s.httpCode ? ' (' + s.httpCode + ')' : '');
      tr.innerHTML =
        '<td class="px-3 py-2 border border-gray-200 align-top">' + escHtml(s.name || '') + '</td>' +
        '<td class="px-3 py-2 border border-gray-200 align-top text-xs">' + escHtml(s.permission || '') + '</td>' +
        '<td class="px-3 py-2 border border-gray-200 align-top">' + statusHtml + '</td>' +
        '<td class="px-3 py-2 border border-gray-200 align-top text-xs text-gray-600 break-all">' + escHtml(s.detail || '') + '</td>';
      tbody.appendChild(tr);
    });

    card.classList.remove('hidden');
  }

  function runReadWriteTest() {
    const input = document.getElementById('rwMailboxInput');
    const btn = document.getElementById('rwTestBtn');
    const status = document.getElementById('rwStatusMessage');
    const card = document.getElementById('rwResultCard');
    const mailbox = input ? input.value.trim() : '';

    if (!mailbox) {
      alert('Please enter the target mailbox to test.');
      return;
    }

    if (btn) { btn.disabled = true; btn.classList.add('opacity-50', 'cursor-not-allowed'); }
    if (status) status.classList.remove('hidden');
    if (card) card.classList.add('hidden');

    google.script.run
      .withSuccessHandler(function (report) {
        if (btn) { btn.disabled = false; btn.classList.remove('opacity-50', 'cursor-not-allowed'); }
        if (status) status.classList.add('hidden');
        renderReadWriteResult(report || {});
      })
      .withFailureHandler(function (err) {
        if (btn) { btn.disabled = false; btn.classList.remove('opacity-50', 'cursor-not-allowed'); }
        if (status) status.classList.add('hidden');
        alert('Critical connection failure: ' + ((err && err.message) ? err.message : err));
      })
      .testMailReadWriteCapability(mailbox);
  }

  // ============================================================
  // MIME reply threading test (Mail.Read + Mail.Send)
  // ============================================================

  function renderThreadResult(report) {
    report = report || {};
    var card = document.getElementById('thResultCard');
    var summary = document.getElementById('thSummary');
    var tag = document.getElementById('thTag');
    var tbody = document.getElementById('thStepRows');
    if (!card || !summary || !tag || !tbody) return;

    var ok = !!report.success;
    summary.innerText = report.summary || (ok ? 'Threading works.' : 'Threading test failed.');
    summary.className = 'text-sm font-semibold mb-2 ' + (ok ? 'text-green-700' : 'text-red-600');
    tag.innerText = 'Thread tag: ' + (report.threadTag || '-') +
      (report.seedConversationId ? ' | seed conv: ' + String(report.seedConversationId).slice(0, 32) + '...' : '') +
      (report.replyConversationId ? ' | reply conv: ' + String(report.replyConversationId).slice(0, 32) + '...' : '');

    tbody.innerHTML = '';
    (Array.isArray(report.steps) ? report.steps : []).forEach(function (s) {
      var tr = document.createElement('tr');
      var statusHtml = s.ok
        ? '<span class="font-semibold text-green-700">PASS</span>' + (s.httpCode ? ' (' + s.httpCode + ')' : '')
        : '<span class="font-semibold text-red-600">FAIL</span>' + (s.httpCode ? ' (' + s.httpCode + ')' : '');
      tr.innerHTML =
        '<td class="px-3 py-2 border border-gray-200 align-top">' + escHtml(s.name || '') + '</td>' +
        '<td class="px-3 py-2 border border-gray-200 align-top text-xs">' + escHtml(s.permission || '') + '</td>' +
        '<td class="px-3 py-2 border border-gray-200 align-top">' + statusHtml + '</td>' +
        '<td class="px-3 py-2 border border-gray-200 align-top text-xs text-gray-600 break-all">' + escHtml(s.detail || '') + '</td>';
      tbody.appendChild(tr);
    });

    card.classList.remove('hidden');
  }

  function threadMailboxAndSender() {
    var input = document.getElementById('thMailboxInput');
    var mailbox = input ? input.value.trim() : '';
    var sender = '';
    try {
      sender = (window.currentUser && window.currentUser.email)
        || JSON.parse(localStorage.getItem('recon_user_secure') || '{}').email
        || '';
    } catch (e) { sender = ''; }
    if (!mailbox) { alert('Please enter the test mailbox (use your own).'); return null; }
    if (!sender) { alert('ERP user email is missing. Please log in through the sidebar first.'); return null; }
    return { mailbox: mailbox, sender: sender };
  }

  function runThreadSeed() {
    var ctx = threadMailboxAndSender();
    if (!ctx) return;
    if (!confirm('Step 1 sends 1 REAL seed email to ' + ctx.mailbox + '. Continue?')) return;
    var btn = document.getElementById('thSeedBtn');
    var status = document.getElementById('thStatusMessage');
    var card = document.getElementById('thResultCard');
    var tagInput = document.getElementById('thTagInput');
    if (btn) { btn.disabled = true; btn.classList.add('opacity-50', 'cursor-not-allowed'); }
    if (status) { status.innerText = 'Sending seed...'; status.classList.remove('hidden'); }
    if (card) card.classList.add('hidden');

    google.script.run
      .withSuccessHandler(function (report) {
        if (btn) { btn.disabled = false; btn.classList.remove('opacity-50', 'cursor-not-allowed'); }
        if (status) status.classList.add('hidden');
        renderThreadResult(report || {});
        if (report && report.threadTag && tagInput) tagInput.value = report.threadTag;
      })
      .withFailureHandler(function (err) {
        if (btn) { btn.disabled = false; btn.classList.remove('opacity-50', 'cursor-not-allowed'); }
        if (status) status.classList.add('hidden');
        alert('Critical connection failure: ' + ((err && err.message) ? err.message : err));
      })
      .testSendThreadSeed({ mailbox: ctx.mailbox, sender: ctx.sender });
  }

  function runThreadReply() {
    var ctx = threadMailboxAndSender();
    if (!ctx) return;
    var tagInput = document.getElementById('thTagInput');
    var tag = tagInput ? tagInput.value.trim() : '';
    if (!tag) { alert('Enter the thread tag from Step 1 (it auto-fills after Step 1).'); return; }
    if (!confirm('Step 2 sends the threaded reply for ' + tag + ' to ' + ctx.mailbox + '. Only continue AFTER you received the seed. Continue?')) return;
    var btn = document.getElementById('thReplyBtn');
    var status = document.getElementById('thStatusMessage');
    var card = document.getElementById('thResultCard');
    if (btn) { btn.disabled = true; btn.classList.add('opacity-50', 'cursor-not-allowed'); }
    if (status) { status.innerText = 'Finding seed, replying, verifying... (takes ~1 min)'; status.classList.remove('hidden'); }
    if (card) card.classList.add('hidden');

    google.script.run
      .withSuccessHandler(function (report) {
        if (btn) { btn.disabled = false; btn.classList.remove('opacity-50', 'cursor-not-allowed'); }
        if (status) status.classList.add('hidden');
        renderThreadResult(report || {});
      })
      .withFailureHandler(function (err) {
        if (btn) { btn.disabled = false; btn.classList.remove('opacity-50', 'cursor-not-allowed'); }
        if (status) status.classList.add('hidden');
        alert('Critical connection failure: ' + ((err && err.message) ? err.message : err));
      })
      .testSendThreadReply({ mailbox: ctx.mailbox, sender: ctx.sender, threadTag: tag });
  }

  (function prefillThreadMailbox() {
    var input = document.getElementById('thMailboxInput');
    if (!input || input.value) return;
    try {
      var email = (window.currentUser && window.currentUser.email)
        || JSON.parse(localStorage.getItem('recon_user_secure') || '{}').email
        || '';
      if (email) input.value = email;
    } catch (e) { /* leave blank */ }
  })();

  prefillReadWriteMailbox();
