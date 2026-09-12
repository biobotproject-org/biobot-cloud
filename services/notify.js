const nodemailer = require('nodemailer');

// Email notifications for incidents.
//
// Configure with SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE,
// ALERT_EMAIL_FROM and ALERT_EMAIL_TO (comma separated). With nothing
// configured, sends are skipped and logged so the ingest path never fails
// because mail is not set up. ALERT_EMAIL_TRANSPORT=json swaps in
// nodemailer's JSON transport, which captures messages instead of sending
// them; tests use that.

let transport = null;
let sent = [];  // only populated by the json transport

function buildTransport() {
  if (process.env.ALERT_EMAIL_TRANSPORT === 'json') {
    return nodemailer.createTransport({ jsonTransport: true });
  }
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });
}

function getTransport() {
  if (transport === null) transport = buildTransport() || false;
  return transport || null;
}

function recipients() {
  return (process.env.ALERT_EMAIL_TO || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
}

function isConfigured() {
  return Boolean(getTransport()) && recipients().length > 0;
}

function fmt(n, digits = 1) {
  return (n === null || n === undefined || Number.isNaN(Number(n))) ? 'n/a' : Number(n).toFixed(digits);
}

// Plain-text email. Deliberately no HTML: it has to read on any phone, in
// any client, with no images blocked.
function composeIncidentEmail({ incident, event, device, baseUrl }) {
  const name = device.name || device.deviceId;
  const readings = event.readings || {};
  const baseline = event.baseline || {};
  const signals = (event.signals || []).map(s => String(s).replace(/_/g, ' ')).join(', ') || 'none';

  const headline = {
    raised:  `${event.severity.toUpperCase()} at ${name}`,
    updated: `${event.severity.toUpperCase()} continues at ${name}`,
    cleared: `All clear at ${name}`,
  }[event.event] || `${event.severity} at ${name}`;

  const lines = [];
  lines.push(headline);
  lines.push('');
  if (event.event === 'cleared') {
    lines.push(`The node reports readings are back to normal. The incident was open for ${durationText(incident.openedAt, event.occurredAt)}.`);
  } else {
    lines.push(`Node ${name} (${device.deviceId}) reports ${event.severity}, score ${event.score}.`);
    lines.push(`Signals: ${signals}.`);
  }
  lines.push('');
  lines.push('Readings now          Normal here');
  lines.push(`PM2.5      ${pad(fmt(readings.pm25))} µg/m³   ${fmt(baseline.pm25)} µg/m³`);
  lines.push(`Gas        ${pad(fmt(readings.gasResistance))} kΩ      ${fmt(baseline.gasResistance)} kΩ`);
  lines.push(`Humidity   ${pad(fmt(readings.humidity))} %       ${fmt(baseline.humidity)} %`);
  lines.push(`Temp       ${pad(fmt(readings.temperature))} °C      ${fmt(baseline.temperature)} °C`);
  if (device.latitude !== null && device.latitude !== undefined && device.longitude !== null && device.longitude !== undefined) {
    lines.push('');
    lines.push(`Location: https://www.openstreetmap.org/?mlat=${device.latitude}&mlon=${device.longitude}#map=15/${device.latitude}/${device.longitude}`);
  }
  lines.push('');
  if (event.event !== 'cleared') {
    lines.push('If you can check the area safely, do so and record what you found on the dashboard.');
    lines.push('If you see fire, call 911 first. Then the BC Wildfire Service on 1 800 663-5555 or *5555 from a cell phone.');
  }
  if (baseUrl) {
    lines.push('');
    lines.push(`Incident: ${baseUrl.replace(/\/$/, '')}/incidents/${incident.id}`);
  }
  lines.push('');
  lines.push('Sent by BioBot. Reply to this email to reach the team.');

  return {
    subject: `[BioBot] ${headline}`,
    text: lines.join('\n'),
  };
}

function pad(s) { return String(s).padStart(6); }

function durationText(from, to) {
  const ms = new Date(to) - new Date(from);
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

async function sendIncidentEmail(args) {
  const t = getTransport();
  const to = recipients();
  if (!t || to.length === 0) {
    console.log(`[notify] email not configured; skipping ${args.event.event} for incident ${args.incident.id}`);
    return { skipped: true };
  }
  const { subject, text } = composeIncidentEmail(args);
  const info = await t.sendMail({
    from: process.env.ALERT_EMAIL_FROM || 'BioBot <biobot@localhost>',
    to,
    subject,
    text,
  });
  if (info && info.message) {
    try { sent.push(JSON.parse(info.message)); } catch { /* not json transport */ }
  }
  return { skipped: false, subject };
}

// Test helpers.
function _sentMessages() { return sent; }
function _reset() { transport = null; sent = []; }

module.exports = { sendIncidentEmail, composeIncidentEmail, isConfigured, _sentMessages, _reset };
