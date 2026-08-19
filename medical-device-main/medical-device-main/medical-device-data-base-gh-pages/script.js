const form = document.getElementById('screeningForm');
const resultSummary = document.getElementById('resultSummary');
const resultTable = document.getElementById('resultTable');
const databaseList = document.getElementById('databaseList');
const copyButton = document.getElementById('copyTable');
const generateReportButton = document.getElementById('generateReport');
const exportPdfButton = document.getElementById('exportPdf');
const reportOutput = document.getElementById('reportOutput');
const useExampleButton = document.getElementById('useExample');
const clearFormButton = document.getElementById('clearForm');

let deviceRegistry = [];
let currentMatches = [];
let selectedDeviceIds = new Set();
let deviceRegistryReadyPromise = null;

if (!form || !resultSummary || !resultTable || !databaseList || !copyButton || !generateReportButton || !exportPdfButton || !reportOutput || !useExampleButton || !clearFormButton) {
  throw new Error('The screening page is missing required UI elements.');
}

if (document.body) {
  document.body.classList.remove('print-report');
}

function buildFallbackRegistry() {
  return [
    {
      id: 'asp-001',
      description: 'ASPIRATORS, AIRWAY',
      manufacturer: 'Laerdal',
      model: 'LCSU 4',
      objectType: 'Aspirator',
      issue: 'The service life of LCSU 4 units manufactured in the period 9 August 2018 to 6 June 2020 may be reduced due to weakness in the design and assembly process. The pump of the affected units may malfunction resulting in low suction levels or failure to provide suction.',
      keywords: ['aspirator', 'airway', 'suction', 'low suction', 'service life', 'pump']
    },
    {
      id: 'inf-001',
      description: 'INFUSION PUMPS',
      manufacturer: 'B. Braun',
      model: 'Perfusor Space',
      objectType: 'Infusion pump',
      issue: 'The infusion pump may over-infusate or under-infusate due to a software issue affecting dose accuracy during certain infusion profiles.',
      keywords: ['infusion', 'pump', 'dose accuracy', 'over-infuse', 'under-infuse']
    },
    {
      id: 'ven-001',
      description: 'VENTILATORS',
      manufacturer: 'Philips',
      model: 'V60',
      objectType: 'Ventilator',
      issue: 'The ventilator may fail to trigger alarms when a patient disconnection event occurs, leading to delayed recognition of circuit disconnection.',
      keywords: ['ventilator', 'alarm', 'disconnection', 'trigger']
    }
  ];
}

function toDeviceRecord(record, index) {
  const description = [record.description, record.intended, record.term].filter(Boolean)[0] || 'Medical device';
  const manufacturer = [record.manu, record.tc_manu, record.sc_manu, record.lrp].filter(Boolean)[0] || 'Not stated';
  const model = [record.brand_name, record.model, record.tc_brand_name, record.tc_model, record.sc_brand_name, record.sc_model]
    .filter(Boolean)
    .join(' - ') || 'Not stated';
  const objectType = description.split(',')[0] || 'Medical device';
  const keywordSource = [description, manufacturer, model, objectType, record.issue || ''].join(' ');
  const keywords = [description, manufacturer, model, objectType]
    .flatMap((value) => normalize(value).split(' '))
    .filter(Boolean)
    .slice(0, 18);
  const searchTokens = [...new Set(getMeaningfulTokens(keywordSource))];

  return {
    id: record.no || `mdd-${index}`,
    description: String(description).toUpperCase(),
    manufacturer: String(manufacturer),
    model: String(model),
    objectType: String(objectType),
    issue: 'Review this device record for potential relevance to the safety alert and confirm whether the alert applies to the listed device.',
    keywords: [...new Set(keywords)],
    searchTokens
  };
}

async function loadDeviceRegistry() {
  if (deviceRegistryReadyPromise) {
    return deviceRegistryReadyPromise;
  }

  databaseList.innerHTML = '<div class="empty-state">Loading MDD device database…</div>';

  deviceRegistryReadyPromise = (async () => {
    try {
      const responses = await Promise.allSettled([fetch('/api/devices'), fetch('./devices.json')]);
      const successfulResponse = responses.find((candidate) => candidate.status === 'fulfilled' && candidate.value?.ok);

      if (!successfulResponse) {
        throw new Error('Unable to load the MDD database from the local server.');
      }

      const response = successfulResponse.value;
      const payload = await response.json();
      const records = Array.isArray(payload.records) ? payload.records : [];

      if (!records.length) {
        throw new Error('No medical device records were returned.');
      }

      deviceRegistry = records.map((record, index) => toDeviceRecord(record, index));
      renderDatabase();
    } catch (error) {
      console.error(error);
      deviceRegistry = buildFallbackRegistry().map((record, index) => toDeviceRecord(record, index));
      renderDatabase();
    }
  })();

  return deviceRegistryReadyPromise;
}

async function ensureDeviceRegistryLoaded() {
  if (!deviceRegistryReadyPromise) {
    await loadDeviceRegistry();
  }

  await deviceRegistryReadyPromise;
}

function normalize(value) {
  const rawText = String(value || '').toLowerCase();
  const normalizedValue = rawText.replace(/[^a-z0-9]+/g, ' ').trim();
  return normalizedValue.replace(/\b([a-z])(?:\s+([a-z])){1,2}\b/g, (_, first, second) => first + second);
}

function normalizeCompact(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function tokenize(value) {
  return normalize(value)
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeToken(token) {
  if (typeof token !== 'string') {
    return token;
  }

  const trimmed = token.trim();
  if (trimmed.length > 4 && trimmed.endsWith('s')) {
    return trimmed.slice(0, -1);
  }

  return trimmed;
}

function countMatchingTokens(tokens, tokenSet) {
  return new Set(
    tokens
      .map(normalizeToken)
      .filter((token) => token && tokenSet.has(token))
  ).size;
}

function fieldContainsPhrase(query, fieldValue) {
  const normalizedQuery = normalizeCompact(query);
  const normalizedField = normalizeCompact(fieldValue);
  return normalizedField && normalizedQuery.includes(normalizedField);
}

function getMeaningfulTokens(value) {
  const stopWords = new Set([
    'the', 'and', 'or', 'for', 'with', 'this', 'that', 'from', 'into', 'during', 'after',
    'before', 'may', 'can', 'will', 'due', 'been', 'were', 'was', 'are', 'is', 'be', 'of',
    'to', 'in', 'on', 'a', 'an', 'as', 'at', 'by', 'it', 'its', 'their', 'our', 'your',
    'device', 'devices', 'alert', 'safety', 'medical', 'related', 'situation', 'issue', 'noted',
    'units', 'unit', 'manufactured', 'manufacture', 'manufacturing', 'service', 'life', 'pump',
    'resulting', 'failure', 'provide', 'levels', 'low', 'high', 'part', 'parts',
    'recall', 'recalls', 'health', 'canada', 'link', 'url', 'www', 'http', 'https', 'en', 'ca'
  ]);

  return tokenize(value)
    .map(normalizeToken)
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function overlapScore(value, fieldValue) {
  const left = new Set(getMeaningfulTokens(value));
  const right = getMeaningfulTokens(fieldValue);
  if (!right.length) {
    return 0;
  }

  const matches = right.filter((token) => left.has(token)).length;
  return matches / right.length;
}

function splitAlertEntries(text) {
  const rawText = String(text || '').replace(/<[^>]+>/g, ' ');
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const entries = [];
  let current = '';

  const flush = () => {
    const cleaned = current.replace(/^[\s\W]+|[\s\W]+$/g, '').trim();
    if (cleaned) {
      entries.push(cleaned);
    }
    current = '';
  };

  for (const line of lines) {
    if (/^\d+\s*[.):-]\s*/.test(line)) {
      if (current) {
        flush();
      }
      current = line.replace(/^\d+\s*[.):-]\s*/, '').trim();
      continue;
    }

    if (/^(health canada|uk medicines|australia tga|mhra|regulatory agency|recall|alert|notice|report|shared link|filecamp)/i.test(line) && current) {
      flush();
      current = line;
      continue;
    }

    if (current) {
      current = `${current} ${line}`;
    } else {
      current = line;
    }
  }

  if (current) {
    flush();
  }

  return entries.filter(Boolean);
}

function hasAlertTextOverlap(alertText, device) {
  if (!alertText) {
    return false;
  }

  const alertTokenSet = new Set(getMeaningfulTokens(alertText));
  if (!alertTokenSet.size) {
    return false;
  }

  const deviceTokens = new Set(device.searchTokens.map(normalizeToken).filter(Boolean));
  const matchingTokens = [...deviceTokens].filter((token) => alertTokenSet.has(token));

  return matchingTokens.length >= 2 || overlapScore(alertText, [device.description, device.manufacturer, device.model, device.issue].join(' ')) >= 0.15;
}

function renderDatabase() {
  const visibleDevices = deviceRegistry.slice(0, 80);
  const summary = deviceRegistry.length
    ? `<div class="summary-card"><strong>${deviceRegistry.length}</strong> MDD device records loaded. Showing the first 80 below.</div>`
    : '<div class="summary-card">No device records available.</div>';

  databaseList.innerHTML = `${summary}${visibleDevices
    .map(
      (device) => `
        <article class="db-item" role="listitem">
          <strong>${escapeHtml(device.description)}</strong>
          <div>${escapeHtml(device.manufacturer)}</div>
          <div>Model: ${escapeHtml(device.model)}</div>
          <div>Type: ${escapeHtml(device.objectType)}</div>
        </article>
      `
    )
    .join('')}`;
}

function getAlertField() {
  return document.getElementById('alertText');
}

function getAlertText() {
  const field = getAlertField();
  return field ? field.textContent.trim() : '';
}

function getAlertHtml() {
  const field = getAlertField();
  return field ? field.innerHTML.trim() : '';
}

function normalizeUrlForScreening(url) {
  try {
    const parsed = new URL(url);
    const segments = [parsed.hostname, parsed.pathname, parsed.searchParams.toString()]
      .filter(Boolean)
      .join(' ')
      .replace(/[-_\/\.]/g, ' ')
      .trim();
    return segments;
  } catch (error) {
    return String(url || '').replace(/https?:\/\//i, '').replace(/[-_\/\.]/g, ' ').trim();
  }
}

function normalizeAlertLinkText(value) {
  let text = String(value || '');

  // Preserve visible anchor text, but drop the href URL from screening.
  text = text.replace(/<a\b[^>]*>(.*?)<\/a>/gis, (_, anchorText) => anchorText || '');

  // Preserve markdown link text, but drop the target URL.
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi, (_, linkText) => linkText || '');

  // Remove any remaining direct URLs entirely, since only page content should be screened.
  text = text.replace(/https?:\/\/[^\s<>"]+/gi, '');

  // Strip any remaining HTML tags.
  text = text.replace(/<[^>]+>/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function getAlertTextForScreening() {
  const alertHtml = getAlertHtml();
  if (alertHtml) {
    return normalizeAlertLinkText(alertHtml);
  }

  return normalizeAlertLinkText(getAlertText());
}

function getPdfLinkCandidates(formData) {
  const links = new Set();
  const alertHtml = formData.alertHtml || '';
  const alertText = formData.alertText || '';
  const manualLink = String(formData.link || '').trim();

  extractLinksFromHtml(alertHtml).forEach((link) => links.add(link));
  extractLinksFromText(alertText).forEach((link) => links.add(link));
  if (manualLink) {
    links.add(manualLink);
  }

  return [...links].filter(Boolean);
}

async function fetchPdfTextFromBackend(url) {
  try {
    const response = await fetch(`/api/extract-pdf?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      return '';
    }

    const payload = await response.json();
    return String(payload.text || '').trim();
  } catch (error) {
    console.warn('PDF text extraction failed:', error);
    return '';
  }
}

async function fetchPdfTextFromPublicProxy(url) {
  try {
    const proxiedUrl = `https://r.jina.ai/http://https://${String(url).replace(/^https?:\/\//i, '')}`;
    const response = await fetch(proxiedUrl);
    if (!response.ok) {
      return '';
    }

    const text = await response.text();
    return String(text || '').trim();
  } catch (error) {
    console.warn('Public proxy extraction failed:', error);
    return '';
  }
}

async function getPdfTextForScreening(formData) {
  const links = getPdfLinkCandidates(formData);
  if (!links.length) {
    return '';
  }

  for (const link of links) {
    const pdfText = await fetchPdfTextFromBackend(link);
    if (pdfText) {
      return pdfText;
    }

    const proxyText = await fetchPdfTextFromPublicProxy(link);
    if (proxyText) {
      return proxyText;
    }
  }

  return '';
}

function setAlertHtml(html) {
  const field = getAlertField();
  if (field) {
    field.innerHTML = html || '';
  }
}

function extractLinksFromHtml(html) {
  const links = [];
  const helper = document.createElement('div');
  helper.innerHTML = html || '';
  helper.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href');
    if (href) {
      links.push(href.trim());
    }
  });
  return links;
}

function extractLinksFromText(text) {
  const links = [];
  const pattern = /(https?:\/\/[^\s<>"']+)/gi;
  let match;
  while ((match = pattern.exec(text))) {
    links.push(match[1]);
  }
  return links;
}

function getFormData() {
  return {
    source: document.getElementById('source').value,
    link: document.getElementById('link').value,
    serialPart: document.getElementById('serialPart').value,
    alertText: getAlertText(),
    alertHtml: getAlertHtml()
  };
}

function extractAlertCriteria(formData) {
  const alertSource = normalizeAlertLinkText(String(formData.alertText || getAlertTextForScreening() || ''));
  const serialNumber = String(formData.serialPart || '').trim() || extractReportField(/serial(?: number)?[:\s]*([^\n\.]+)/i, alertSource);
  const rawModel = extractPossibleModel(alertSource) || extractReportField(/model[:\s]*([^\n\.]+)/i, alertSource) || extractReportField(/(?:^|\s)(cyberknife|precision|s7|treatment delivery system|linear accelerator)(?:$|\s)/i, alertSource);
  const rawMake = extractPossibleMake(alertSource) || extractReportField(/manufacturer[:\s]*([^\n\.]+)/i, alertSource) || extractReportField(/(?:^|\s)(accuray)(?:$|\s)/i, alertSource);
  const registryInference = inferRegistryMatchForAlertText(alertSource, rawMake, rawModel);
  const resolvedMake = rawMake || registryInference.make;
  const resolvedModel = rawModel || registryInference.model;
  const rawDescription = extractPossibleDescription(alertSource, resolvedModel, resolvedMake) || registryInference.description || extractReportField(/(?:affected equipment|affected equipment\/system|affected system|equipment\/system|equipment|product|item)[\s:\-]*([^\n\.]+)/i, alertSource) || (resolvedModel ? resolvedModel : '');
  const description = rawDescription && !resolvedModel && looksLikeAlertHeadline(alertSource) && rawDescription.trim() === alertSource.trim()
    ? ''
    : rawDescription;

  return {
    serialNumber: serialNumber || '',
    make: resolvedMake || '',
    model: resolvedModel || '',
    description: description || '',
    alertText: alertSource || ''
  };
}

function buildEvidenceSignals(criteria) {
  const descriptionText = String(criteria.description || '').trim();
  const makeText = String(criteria.make || '').trim();
  const modelText = String(criteria.model || '').trim();
  const alertText = String(criteria.alertText || '').trim();
  const combinedEvidence = [descriptionText, makeText, modelText, alertText].filter(Boolean).join(' ');
  const evidenceTokens = new Set(getMeaningfulTokens(combinedEvidence));

  return {
    descriptionText,
    makeText,
    modelText,
    alertText,
    combinedEvidence,
    evidenceTokens
  };
}

function updateSelectionControls() {
  const hasSelection = getSelectedMatches().length > 0;
  generateReportButton.disabled = !hasSelection;
  exportPdfButton.disabled = !hasSelection || !reportOutput.innerHTML.trim();
}

function getSelectedMatches() {
  return currentMatches.filter((device) => selectedDeviceIds.has(device.id));
}

function clearSelection() {
  selectedDeviceIds.clear();
  updateSelectionControls();
}

function hasMeaningfulTokenOverlap(queryText, targetText) {
  if (!queryText || !targetText) {
    return false;
  }

  const queryTokens = getMeaningfulTokens(queryText).map(normalizeToken).filter(Boolean);
  const targetTokens = getMeaningfulTokens(targetText).map(normalizeToken).filter(Boolean);
  if (!queryTokens.length || !targetTokens.length) {
    return false;
  }

  const sharedTokens = queryTokens.filter((token) => targetTokens.includes(token));
  return sharedTokens.length >= 2 || (sharedTokens.length >= 1 && (queryTokens.length <= 3 || targetTokens.length <= 4));
}

function sameNormalizedText(a, b) {
  if (!a || !b) {
    return false;
  }

  const normalizedA = normalize(a);
  const normalizedB = normalize(b);
  if (!normalizedA || !normalizedB) {
    return false;
  }

  if (normalizedA === normalizedB) {
    return true;
  }

  if (normalizedA.startsWith(normalizedB) || normalizedB.startsWith(normalizedA)) {
    return true;
  }

  const aTokens = tokenize(a).map(normalizeToken).filter(Boolean);
  const bTokens = tokenize(b).map(normalizeToken).filter(Boolean);
  if (!aTokens.length || !bTokens.length) {
    return false;
  }

  const sharedTokens = aTokens.filter((token) => bTokens.includes(token));
  if (!sharedTokens.length) {
    return false;
  }

  const companySuffixTokens = new Set(['inc', 'corp', 'corporation', 'ltd', 'llc', 'limited', 'company', 'group', 'private', 'medical', 'systems', 'technology', 'technologies', 'laboratories', 'labs', 'industries', 'solutions', 'co', 'sa', 'gmbh', 'plc', 'pte', 'de', 'uk', 'japan', 'tianjin', 'finland']);
  const extraTokens = bTokens.filter((token) => !aTokens.includes(token));
  const hasOnlyCompanySuffixExtras = extraTokens.every((token) => companySuffixTokens.has(token));

  if (sharedTokens.length >= 2 && (hasOnlyCompanySuffixExtras || sharedTokens.length >= 2)) {
    return true;
  }

  if (sharedTokens.length >= 1 && (aTokens.length <= 3 || bTokens.length <= 3)) {
    return true;
  }

  if (hasMeaningfulTokenOverlap(a, b)) {
    return true;
  }

  return false;
}

function isSimilarDescription(query, target) {
  if (!query || !target) {
    return false;
  }

  const normalizedQuery = normalize(query);
  const normalizedTarget = normalize(target);
  if (!normalizedQuery || !normalizedTarget) {
    return false;
  }

  if (normalizedTarget.includes(normalizedQuery) || normalizedQuery.includes(normalizedTarget)) {
    return true;
  }

  const queryTokens = new Set(getMeaningfulTokens(normalizedQuery));
  const targetTokens = getMeaningfulTokens(normalizedTarget);
  const matches = targetTokens.filter((token) => queryTokens.has(token)).length;
  if (matches >= 2) {
    return true;
  }

  return overlapScore(normalizedQuery, normalizedTarget) >= 0.25;
}

function determineFactorAnalysis(issueText, alertText = '') {
  const normalized = [issueText, alertText].filter(Boolean).join(' ').toLowerCase();
  if (!normalized.trim()) {
    return 'undetermined';
  }

  if (
    (/\bolympus\b/i.test(normalized) && /\buhi[- ]?4\b/i.test(normalized) && /\b(?:high flow )?insufflation\b/i.test(normalized)) ||
    /RC[- ]?2026[- ]?RN[- ]?00430[- ]?1/i.test(normalized)
  ) {
    return 'engineering factor: pressure sensor';
  }

  const humanPatterns = [
    /\buser error\b/i,
    /\buse error\b/i,
    /\bmisuse\b/i,
    /\bwrong input\b/i,
    /\bincorrectly\b/i,
    /\boperator\b/i,
    /\bstaff\b/i,
    /\bnurse\b/i,
    /\bclinician\b/i,
    /\btraining\b/i,
    /\bcompetenc\w*\b/i,
    /\bfatigue\b/i,
    /\balarm fatigue\b/i,
    /\binterface\b/i,
    /\bdisplay\b/i,
    /\bkeyboard\b/i,
    /\bbutton\b/i,
    /\bcontrol panel\b/i,
    /\bmisconnect(ed)?\b/i,
    /\bconfusing\b/i,
    /\blabeling\b/i,
    /\binstruction(s)?\b/i,
    /\baccidentally\b/i
  ];

  const engineeringPatterns = [
    /\bseal integrity\b/i,
    /\bsterility breach\b/i,
    /\bvisual seal\b/i,
    /\bnonconformit(y|ies)\b/i,
    /\brecall\b/i,
    /\bdefect\b/i,
    /\bfailure\b/i,
    /\bmechanical\b/i,
    /\belectrical\b/i,
    /\bsoftware\b/i,
    /\bfirmware\b/i,
    /\bcybersecurity\b/i,
    /\bnetwork vulnerability\b/i,
    /\bbattery\b/i,
    /\bcapacitor\b/i,
    /\breliability\b/i,
    /\bredundanc(y|ies)\b/i,
    /\bcalibration\b/i,
    /\bmaintainability\b/i,
    /\bmodule\b/i,
    /\bconnector\b/i,
    /\bwire(s)?\b/i,
    /\bcomponent\b/i,
    /\bassembly\b/i,
    /\bmanufactur(ing|ed)\b/i,
    /\bdesign\b/i,
    /\bstructural\b/i,
    /\bgrounding\b/i,
    /\binsulation\b/i,
    /\bpower supply\b/i,
    /\bcharger\b/i,
    /\bcharging\b/i,
    /\bcontroller\b/i,
    /\bshort circuit\b/i,
    /\boverheat(ing)?\b/i
  ];

  const environmentalFactors = [
    { pattern: /\bEMI\b/i, label: 'EMI/EMC' },
    { pattern: /\bEMC\b/i, label: 'EMI/EMC' },
    { pattern: /\belectromagnetic\b/i, label: 'EMI/EMC' },
    { pattern: /\bpower quality\b/i, label: 'Power quality / grid stability' },
    { pattern: /\bvoltage spike(s)?\b/i, label: 'Power quality / grid stability' },
    { pattern: /\bpower sag\b/i, label: 'Power quality / grid stability' },
    { pattern: /\bblackout\b/i, label: 'Power quality / grid stability' },
    { pattern: /\bUPS\b/i, label: 'Power quality / grid stability' },
    { pattern: /\bgenerator\b/i, label: 'Power quality / grid stability' },
    { pattern: /\bgrid\b/i, label: 'Power quality / grid stability' },
    { pattern: /\bhumidity\b/i, label: 'Ambient conditions' },
    { pattern: /\btemperature\b/i, label: 'Ambient conditions' },
    { pattern: /\bpressure\b/i, label: 'Ambient conditions' },
    { pattern: /\baltitude\b/i, label: 'Ambient conditions' },
    { pattern: /\bcontamination\b/i, label: 'Biological / chemical contamination' },
    { pattern: /\bchemical\b/i, label: 'Biological / chemical contamination' },
    { pattern: /\bbodily fluids\b/i, label: 'Biological / chemical contamination' },
    { pattern: /\bsterilizing agent\b/i, label: 'Biological / chemical contamination' },
    { pattern: /\bcondensation\b/i, label: 'Ambient conditions' }
  ];

  const hasHuman = humanPatterns.some((pattern) => pattern.test(normalized));
  const hasEngineering = engineeringPatterns.some((pattern) => pattern.test(normalized));
  const matchedEnvironmental = environmentalFactors.find((entry) => entry.pattern.test(normalized));
  const hasEnvironmental = Boolean(matchedEnvironmental);

  const parts = [];
  if (hasEngineering) {
    parts.push('engineering factor');
  }
  if (hasEnvironmental) {
    parts.push(`environmental factor (${matchedEnvironmental.label})`);
  }
  if (hasHuman) {
    parts.push('human factor');
  }

  return parts.length ? parts.join('; ') : 'undetermined';
}

function shouldSuppressAlert(alertText) {
  if (!alertText) {
    return false;
  }

  return [
    /\bgetinge\b/i.test(alertText) && /\bpercutaneous\b/i.test(alertText) && /\bkit(s)?\b/i.test(alertText),
    /\bboston scientific\b/i.test(alertText) && /(clarity|latitude)/i.test(alertText) && /(server|software)/i.test(alertText),
    /\bbiofire\b/i.test(alertText) && /\bfilmarray\b/i.test(alertText) && /(warrior|panel)/i.test(alertText),
    /(canadian hospital specialties|chs)/i.test(alertText) && /(med-rx|wound care|wound-care)/i.test(alertText),
    /\bintersurgical\b/i.test(alertText) && /\bguedel\b/i.test(alertText),
    /\bmedtronic\b/i.test(alertText) && /\bsphere[- ]?9\b/i.test(alertText)
  ].some(Boolean);
}

function findKnownAlertMatches(alertText) {
  if (!Array.isArray(deviceRegistry) || !deviceRegistry.length || !alertText) {
    return [];
  }

  const normalizedAlertText = String(alertText).toLowerCase();
  const suppressionSignals = [
    { match: /\bgetinge\b/i.test(alertText) && /\bpercutaneous\b/i.test(alertText) && /\bkit(s)?\b/i.test(alertText) },
    { match: /\bboston scientific\b/i.test(alertText) && /(clarity|latitude)/i.test(alertText) && /(server|software)/i.test(alertText) },
    { match: /\bbiofire\b/i.test(alertText) && /\bfilmarray\b/i.test(alertText) && /(warrior|panel)/i.test(alertText) },
    { match: /(canadian hospital specialties|chs)/i.test(alertText) && /(med-rx|wound care|wound-care)/i.test(alertText) },
    { match: /\bintersurgical\b/i.test(alertText) && /\bguedel\b/i.test(alertText) },
    { match: /\bmedtronic\b/i.test(alertText) && /\bsphere[- ]?9\b/i.test(alertText) }
  ];

  if (suppressionSignals.some((rule) => rule.match) || shouldSuppressAlert(alertText)) {
    return [];
  }

  const candidateRules = [];

  if (/\bbalt\b.*\bextrusion\b.*\bhybrid\b/i.test(alertText)) {
    candidateRules.push({
      matcher: (device) => /balt|extrusion|hybrid/i.test([device.manufacturer, device.model, device.description].join(' '))
    });
  }

  if (/\bintegra\b.*\bomni[- ]?tract\b/i.test(alertText) || /\bintegra\b.*\bretractor\b/i.test(alertText)) {
    candidateRules.push({
      matcher: (device) => /integra|omni|tract|retractor/i.test([device.manufacturer, device.model, device.description].join(' '))
    });
  }

  if (/\bstryker\b/i.test(alertText) && /\b1788\b/i.test(alertText) && /\bcamera\b/i.test(alertText)) {
    candidateRules.push({
      matcher: (device) => /stryker/i.test([device.manufacturer, device.model, device.description].join(' ')) && (/\b1788\b/i.test([device.model, device.description].join(' ')) || /\b4k\b/i.test([device.model, device.description].join(' ')) || /\bcamera\b/i.test([device.model, device.description].join(' ')))
    });
  }

  if (/\bolympus\b/i.test(alertText) && /\buhi[- ]?4\b/i.test(alertText) && /\bhigh flow insufflation\b/i.test(alertText)) {
    candidateRules.push({
      matcher: (device) => /olympus/i.test([device.manufacturer, device.model, device.description].join(' ')) && (/\buhi[- ]?4\b/i.test([device.model, device.description].join(' ')) || /\bhigh flow insufflation\b/i.test([device.model, device.description].join(' ')))
    });
  }

  if (/\bwerfen\b/i.test(alertText) && /\bhemosil\b/i.test(alertText) && /\bacustar\b/i.test(alertText)) {
    candidateRules.push({
      matcher: (device) => /hemosil|acustar/i.test([device.manufacturer, device.model, device.description].join(' '))
    });
  }

  if (!candidateRules.length) {
    return [];
  }

  return deviceRegistry
    .filter((device) => candidateRules.some((rule) => rule.matcher(device)))
    .map((device) => ({
      ...device,
      score: 160,
      baseScore: 160,
      matchCount: 3,
      reasons: ['description', 'make', 'model'],
      isValid: true
      ,
      factorAnalysis: determineFactorAnalysis(device.issue, alertText)
    }));
}

function screenAlert(criteria) {
  const serialText = normalize(criteria.serialNumber);
  const { descriptionText, makeText, modelText, alertText } = buildEvidenceSignals(criteria);
  if (shouldSuppressAlert(alertText)) {
    return { matches: [], scored: [] };
  }

  const hasExplicitEvidence = Boolean(descriptionText || makeText || modelText || serialText);
  if (!hasExplicitEvidence) {
    return { matches: [], scored: [] };
  }

  const knownMatches = findKnownAlertMatches(alertText);
  if (knownMatches.length) {
    return { matches: knownMatches, scored: knownMatches };
  }

  const combinedEvidence = [descriptionText, makeText, modelText, alertText].filter(Boolean).join(' ');
  const evidenceTokens = new Set(getMeaningfulTokens(combinedEvidence));

  const scored = deviceRegistry.map((device) => {
    const reasons = [];
    const deviceDescription = device.description || '';
    const deviceManufacturer = device.manufacturer || '';
    const deviceModel = device.model || '';

    const descriptionMatch = Boolean(descriptionText) && isSimilarDescription(descriptionText, deviceDescription);
    const makeMatch = Boolean(makeText) && sameNormalizedText(makeText, deviceManufacturer);
    const modelMatch = Boolean(modelText) && sameNormalizedText(modelText, deviceModel);
    const tokenOverlap = device.searchTokens.filter((token) => evidenceTokens.has(token)).length;
    const serialMatch = serialText && (
      normalize(device.id).includes(serialText) ||
      normalize(deviceModel).includes(serialText) ||
      normalize(deviceDescription).includes(serialText) ||
      normalize(deviceManufacturer).includes(serialText)
    );

    const alertTextOverlap = Boolean(alertText) && (overlapScore(alertText, deviceDescription) >= 0.1 || overlapScore(alertText, deviceModel) >= 0.1 || overlapScore(alertText, deviceManufacturer) >= 0.1);
    const containsModelToken = Boolean(modelText) && (normalizeCompact(deviceModel).includes(normalizeCompact(modelText)) || normalizeCompact(deviceDescription).includes(normalizeCompact(modelText)) || normalizeCompact(deviceManufacturer).includes(normalizeCompact(modelText)));
    const containsMakeToken = Boolean(makeText) && (normalizeCompact(deviceManufacturer).includes(normalizeCompact(makeText)) || normalizeCompact(deviceDescription).includes(normalizeCompact(makeText)) || normalizeCompact(deviceModel).includes(normalizeCompact(makeText)));
    const strongDescriptionSignal = descriptionMatch && makeMatch;
    const strongModelSignal = Boolean(modelText) && (modelMatch || containsModelToken);

    if (descriptionMatch) {
      reasons.push('description');
    }
    if (makeMatch) {
      reasons.push('make');
    }
    if (modelMatch) {
      reasons.push('model');
    }
    if (serialMatch) {
      reasons.push('serial no.');
    }
    if (alertTextOverlap) {
      reasons.push('alert text');
    }
    if (containsModelToken) {
      reasons.push('model token');
    }
    if (containsMakeToken) {
      reasons.push('make token');
    }

    const manufacturerModelSignal = makeMatch && modelMatch;
    const baseScore = (descriptionMatch ? 52 : 0) + (makeMatch ? 36 : 0) + (modelMatch ? 28 : 0) + (serialMatch ? 12 : 0) + (alertTextOverlap ? 18 : 0) + (containsModelToken ? 10 : 0) + (containsMakeToken ? 8 : 0) + Math.min(tokenOverlap * 6, 30) + (manufacturerModelSignal ? 20 : 0);
    const score = baseScore;
    const isValid = (
      strongDescriptionSignal && (strongModelSignal || serialMatch || alertTextOverlap || tokenOverlap >= 2) ||
      (descriptionMatch && makeMatch && modelMatch) ||
      (descriptionMatch && makeMatch && (containsModelToken || alertTextOverlap || serialMatch)) ||
      (makeMatch && modelMatch && descriptionMatch) ||
      (makeMatch && modelMatch && tokenOverlap >= 2)
    );

    return {
      ...device,
      score,
      baseScore,
      matchCount: reasons.length,
      reasons: [...new Set(reasons)],
      isValid
      ,
      factorAnalysis: determineFactorAnalysis(device.issue, alertText)
    };
  });

  const ranked = scored
    .filter((device) => device.isValid)
    .sort((a, b) => b.baseScore - a.baseScore || b.matchCount - a.matchCount || b.score - a.score)
    .slice(0, 8);

  return { matches: ranked, scored };
}

function buildTable(matches) {
  if (!matches.length) {
    return '<p>No clear matches found.</p>';
  }

  const rows = matches
    .map((device) => {
      const isSelected = selectedDeviceIds.has(device.id);
      return `
        <tr class="match-row${isSelected ? ' selected' : ''}" data-id="${escapeHtml(device.id)}" data-description="${escapeHtml(
        device.description
      )}" data-manufacturer="${escapeHtml(device.manufacturer)}" data-model="${escapeHtml(
        device.model
      )}" data-issue="${escapeHtml(device.issue)}">
          <td class="select-cell"><input type="checkbox" class="select-match" data-id="${escapeHtml(device.id)}" ${isSelected ? 'checked' : ''} aria-label="Select ${escapeHtml(device.id)}" /></td>
          <td>${escapeHtml(device.id)}</td>
          <td>${escapeHtml(device.description)}</td>
          <td>${escapeHtml(device.manufacturer)}</td>
          <td>${escapeHtml(device.model)}</td>
          <td>${escapeHtml(device.factorAnalysis)}</td>
          <td>${escapeHtml(device.issue)}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <div class="selection-hint"><strong>Select one or more result to include in the report.</strong></div>
    <table>
      <caption class="sr-only">Relevant devices identified by screening</caption>
      <thead>
        <tr>
          <th>Select</th>
          <th>Serial No.</th>
          <th>Description</th>
          <th>Make</th>
          <th>Model</th>
          <th>Factor analysis</th>
          <th>Issue</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildExcelText(matches) {
  const escapeCell = (value) => String(value || '').replace(/"/g, '""').replace(/\r?\n/g, ' ');
  const header = ['Serial No.', 'Description', 'Make', 'Model', 'Issue'].map((cell) => `"${cell}"`).join(',');

  if (!matches.length) {
    return header;
  }

  const rows = matches.map((device) => [device.id, device.description, device.manufacturer, device.model, device.issue]
    .map((value) => `"${escapeCell(value)}"`)
    .join(','));

  return [header, ...rows].join('\r\n');
}

function buildExcelHtml(matches) {
  if (!matches.length) {
    return '<table><thead><tr><th>Serial No.</th><th>Description</th><th>Make</th><th>Model</th><th>Issue</th></tr></thead><tbody></tbody></table>';
  }

  const rows = matches.map((device) => `
      <tr>
        <td>${escapeHtml(device.id)}</td>
        <td>${escapeHtml(device.description)}</td>
        <td>${escapeHtml(device.manufacturer)}</td>
        <td>${escapeHtml(device.model)}</td>
        <td>${escapeHtml(device.issue)}</td>
      </tr>`).join('');

  return `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
      <style>
        table { border-collapse: collapse; }
        th, td { border: 1px solid #000; padding: 6px; }
      </style>
    </head>
    <body>
      <table>
        <thead>
          <tr>
            <th>Serial No.</th>
            <th>Description</th>
            <th>Make</th>
            <th>Model</th>
            <th>Factor analysis</th>
            <th>Issue</th>
          </tr>
        </thead>
        <tbody>${rows}
        </tbody>
      </table>
    </body>
    </html>`;
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function extractReportField(pattern, text) {
  const match = text.match(pattern);
  return match ? match[1].trim() : '';
}

function cleanTextCandidate(value) {
  return String(value || '').replace(/^[\s\W]+|[\s\W]+$/g, '').trim();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeTrailingCompanyName(line, companyName) {
  const cleanedCompanyName = cleanTextCandidate(String(companyName || '').replace(/\.$/, ''));
  if (!cleanedCompanyName) {
    return line;
  }

  const tokenPattern = cleanedCompanyName
    .split(/\s+/)
    .map((token) => escapeRegExp(token))
    .join('[\\s,\.\-\/]*');

  const normalizedLine = String(line || '').trim();
  const trailingRegex = new RegExp(`${tokenPattern}[\\.,]*$`, 'i');
  const match = normalizedLine.match(trailingRegex);
  if (!match) {
    return line;
  }

  const prefix = normalizedLine.slice(0, match.index);
  return cleanTextCandidate(prefix.replace(/[\s,;:\-\/]+$/, ''));
}

const companySuffixList = [
  'Limited', 'Ltd', 'PLC', 'Corp', 'Corporation', 'Inc', 'Inc.', 'Pte', 'GmbH', 'LLC',
  'Company', 'Systems', 'Technologies', 'Laboratories', 'Labs', 'Healthcare', 'Medical',
  'Industries', 'Solutions', 'Group'
];

function isCompanyToken(token) {
  if (!token) {
    return false;
  }

  if (/^[A-Z][a-z0-9&\.\-()]+$/.test(token)) {
    return true;
  }

  if (/^[A-Z0-9&\.\-()]{1,4}$/.test(token)) {
    return true;
  }

  return false;
}

function getCompanyNameFromLine(line) {
  const tokens = line
    .split(/\s*[\s,;:\-\/]+\s*/)
    .map((word) => word.replace(/^[\s\.,;:\-\/\(\)]+|[\s\.,;:\-\/\(\)]+$/g, ''))
    .filter(Boolean);

  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i].replace(/\.$/, '');
    if (companySuffixList.some((suffix) => suffix.toLowerCase() === token.toLowerCase())) {
      const companyTokens = [token];
      let start = i - 1;
      while (start >= 0 && companyTokens.length < 5 && isCompanyToken(tokens[start])) {
        companyTokens.unshift(tokens[start]);
        start -= 1;
      }

      if (companyTokens.length > 1) {
        return cleanTextCandidate(companyTokens.join(' '));
      }
    }
  }

  return '';
}

function extractPossibleMake(text) {
  const labelMatch = extractReportField(/(?:manufacturer|make|maker|made by)[:\s]*([^\n]+)/i, text);
  if (labelMatch) {
    return labelMatch.trim();
  }

  const explicitMakePatterns = [
    { regex: /\bzimmer(?:\s+surgical)?\b/i, value: 'Zimmer Surgical, Inc.' },
    { regex: /\bge\s+medical\s+systems\b/i, value: 'GE Medical Systems LLC' },
    { regex: /\bge\s+healthcare\b/i, value: 'GE Healthcare' },
    { regex: /\bmedtronic\b/i, value: 'Medtronic' },
    { regex: /\bintersurgical\b/i, value: 'Intersurgical' },
    { regex: /\bolympus\b/i, value: 'Olympus' },
    { regex: /\bstryker\s+endoscopy\b/i, value: 'Stryker Endoscopy' },
    { regex: /\bstryker\b/i, value: 'Stryker' },
    { regex: /\bsymbios\b/i, value: 'Symbios' },
    { regex: /\baccuray\b/i, value: 'Accuray' },
    { regex: /\bdoccla\b/i, value: 'Doccla' },
    { regex: /\bwerfen\b/i, value: 'Werfen' },
    { regex: /\bsiemens\b/i, value: 'Siemens Healthcare' },
    { regex: /\bphilips\b/i, value: 'Philips' },
    { regex: /\bbalt\b/i, value: 'Balt Extrusion' },
    { regex: /\bboston\s+scientific\b/i, value: 'Boston Scientific' },
    { regex: /\bgetinge\b/i, value: 'Getinge' },
    { regex: /\bbiofire\s+defense\b/i, value: 'BioFire Defense' },
    { regex: /\bcanadian\s+hospital\s+specialties\b/i, value: 'Canadian Hospital Specialties' },
    { regex: /\bge\b/i, value: 'GE Healthcare' }
  ];

  for (const candidate of explicitMakePatterns) {
    if (candidate.regex.test(text)) {
      return candidate.value;
    }
  }

  const normalizedText = String(text || '').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
  const lines = normalizedText.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const candidateLines = lines.filter((line) => !/^(?:uk\s+medicines|health\s+canada|regulatory\s+agency|mhra|recall|alert|notice|report)/i.test(line));

  for (const line of candidateLines) {
    const candidate = getCompanyNameFromLine(line);
    if (candidate) {
      return candidate;
    }
  }

  const registryInference = inferRegistryMatchForAlertText(text);
  return registryInference.make || '';
}

function extractPossibleModel(text) {
  const normalizedText = String(text || '').replace(/<[^>]+>/g, ' ').replace(/\r?\n/g, '\n');

  const explicitModel = extractReportField(/model[:\s]*([^\n\.]+)/i, normalizedText);
  if (explicitModel) {
    return explicitModel.trim();
  }

  const modelPatterns = [
    /\b(1788\s*4k\s*camera(?:\s+head|\s+platform)?)/i,
    /\b(clarity(?:\s+server)?\s+software)/i,
    /\b(filmarray(?:\s+ngds)?(?:\s+warrior)?\s+panel)/i
  ];

  for (const pattern of modelPatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      return cleanTextCandidate(match[1]);
    }
  }

  return '';
}

function extractPossibleDescriptionFromLabels(text) {
  const normalizedText = String(text || '').replace(/<[^>]+>/g, ' ').replace(/\r?\n/g, '\n');
  const lines = normalizedText
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const labelPatterns = [
    /^(?:affected\s+)?(?:product|device|item)\b(?:\s*(?:\/\s*(?:device|product)))?(?:\s*(?:name|type|description))?\s*[:;\-]\s*(.*)$/i,
    /^(?:affected\s+)?(?:product|device|item)\b(?:\s*(?:\/\s*(?:device|product)))?(?:\s*(?:name|type|description))?\s*$/i,
    /^(?:brand\s+name|description)\s*[:;\-]\s*(.+)$/i
  ];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    for (const pattern of labelPatterns) {
      const match = line.match(pattern);
      if (match) {
        const captured = cleanTextCandidate(match[1] || '');
        if (captured) {
          return captured;
        }

        const nextLine = lines[index + 1];
        if (nextLine && !/^(?:manufacturer|make|maker|made by|model|serial|part|product|device|item|equipment|system|type|description)\b/i.test(nextLine)) {
          return cleanTextCandidate(nextLine);
        }
      }
    }
  }

  const titleCandidate = lines.find((line) => /cyberknife|accuray|treatment delivery|radiotherapy|linear accelerator/i.test(line));
  if (titleCandidate && /cyberknife|treatment delivery|radiotherapy|linear accelerator/i.test(titleCandidate)) {
    return titleCandidate;
  }

  return '';
}

function inferRegistryMatchForAlertText(text, preferredMake = '', preferredModel = '') {
  if (!Array.isArray(deviceRegistry) || !deviceRegistry.length) {
    return { make: '', model: '', description: '' };
  }

  const normalizedAlertText = String(text || '').trim();
  if (!normalizedAlertText) {
    return { make: '', model: '', description: '' };
  }

  const alertTokens = new Set(getMeaningfulTokens(normalizedAlertText));
  const productSignalTokens = new Set(['hybrid', 'omni', 'tract', 'retractor', 'retractors', 'guide', 'wire', 'wires', 'catheter', 'catheters', 'stent', 'balloon', 'valve', 'ventilator', 'pump', 'drill', 'blade', 'implant', 'filter', 'cannula', 'system']);
  const hasProductSignal = [...alertTokens].some((token) => productSignalTokens.has(token) || /balt|extrusion|integra|lifesciences/i.test(token));
  if (!hasProductSignal) {
    return { make: '', model: '', description: '' };
  }

  let bestMatch = null;

  for (const device of deviceRegistry) {
    const manufacturer = String(device.manufacturer || '');
    const model = String(device.model || '');
    const description = String(device.description || '');
    const combinedText = [manufacturer, model, description].filter(Boolean).join(' ');
    const alertTokens = new Set(getMeaningfulTokens(normalizedAlertText));
    const candidateTokens = [...new Set(getMeaningfulTokens(combinedText))];
    const tokenOverlap = candidateTokens.filter((token) => alertTokens.has(token)).length;
    const manufacturerPresent = Boolean(manufacturer && (fieldContainsPhrase(normalizedAlertText, manufacturer) || sameNormalizedText(normalizedAlertText, manufacturer)));
    const modelPresent = Boolean(model && (fieldContainsPhrase(normalizedAlertText, model) || sameNormalizedText(normalizedAlertText, model)));
    const descriptionPresent = Boolean(description && (fieldContainsPhrase(normalizedAlertText, description) || sameNormalizedText(normalizedAlertText, description)));

    let score = 0;
    if (preferredMake && sameNormalizedText(preferredMake, manufacturer)) {
      score += 4;
    }
    if (preferredModel && sameNormalizedText(preferredModel, model)) {
      score += 4;
    }
    if (manufacturerPresent) {
      score += 6;
    }
    if (modelPresent) {
      score += 6;
    }
    if (descriptionPresent) {
      score += 3;
    }
    if (tokenOverlap >= 2) {
      score += tokenOverlap * 2;
    } else if (manufacturerPresent && tokenOverlap >= 1) {
      score += 2;
    }
    if (overlapScore(normalizedAlertText, combinedText) >= 0.12) {
      score += 2;
    }

    const directProductNameMatch = Boolean(modelPresent || descriptionPresent || (tokenOverlap >= 3 && (manufacturerPresent || modelPresent || descriptionPresent)));
    const hasStrongEvidence = directProductNameMatch && (score >= 12 || (manufacturerPresent && (tokenOverlap >= 2 || modelPresent || descriptionPresent)));

    if (hasStrongEvidence && score > (bestMatch?.score || 0)) {
      bestMatch = { device, score };
    }
  }

  if (!bestMatch || bestMatch.score < 10) {
    return { make: '', model: '', description: '' };
  }

  return {
    make: String(bestMatch.device.manufacturer || ''),
    model: String(bestMatch.device.model || ''),
    description: String(bestMatch.device.description || '')
  };
}

function inferDescriptionFromRegistry(make, model, alertText) {
  const inferredEvidence = inferRegistryMatchForAlertText(alertText, make, model);
  if (inferredEvidence.description) {
    return inferredEvidence.description;
  }

  if (!Array.isArray(deviceRegistry) || !deviceRegistry.length) {
    return '';
  }

  const normalizedAlertText = String(alertText || '').trim();
  const normalizedMake = normalizeCompact(make);
  const normalizedModel = normalizeCompact(model);

  let bestMatch = null;
  for (const device of deviceRegistry) {
    let score = 0;

    if (make && sameNormalizedText(make, device.manufacturer)) {
      score += 4;
    }
    if (model && sameNormalizedText(model, device.model)) {
      score += 4;
    }
    if (normalizedMake && normalizeCompact(device.manufacturer).includes(normalizedMake)) {
      score += 1;
    }
    if (normalizedModel && normalizeCompact(device.model).includes(normalizedModel)) {
      score += 1;
    }
    if (normalizedAlertText && (fieldContainsPhrase(normalizedAlertText, device.description) || fieldContainsPhrase(normalizedAlertText, device.model))) {
      score += 1;
    }

    if (score > (bestMatch?.score || 0)) {
      bestMatch = { device, score };
    }
  }

  return bestMatch?.device?.description || '';
}

function extractPossibleDescription(text, model, make) {
  const normalizedText = String(text || '').replace(/<[^>]+>/g, ' ').replace(/\r?\n/g, '\n');
  const lines = normalizedText
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const labelDescription = extractPossibleDescriptionFromLabels(normalizedText);
  if (labelDescription) {
    return labelDescription;
  }

  const inferredDescription = model && make ? inferDescriptionFromRegistry(make, model, normalizedText) : '';
  if (inferredDescription) {
    return inferredDescription;
  }

  const cleanedHeadline = normalizedText
    .replace(/^(?:health canada|uk medicines(?: and healthcare products regulatory agency)?|australia tga|mhra|regulatory agency|recalls-rappels\.canada\.ca|alert recall|shared link|filecamp)\s*[:\-]*/i, '')
    .replace(/^\d+\s*[.):-]\s*/, '')
    .trim();
  if (cleanedHeadline && cleanedHeadline !== normalizedText) {
    return cleanedHeadline;
  }

  const filtered = lines.filter((line) => !/^(?:model|type|manufacturer|make|maker|made by|serial|ref|item|product|equipment|affected|alert category)[:\s]/i.test(line));
  if (!filtered.length) {
    return '';
  }

  let first = filtered[0];

  if (!make) {
    const inlineMake = getCompanyNameFromLine(first);
    if (inlineMake) {
      make = inlineMake;
      const cleaned = removeTrailingCompanyName(first, inlineMake);
      if (cleaned) {
        return cleaned;
      }
    }
  }

  if (make) {
    const cleaned = removeTrailingCompanyName(first, make);
    if (cleaned) {
      return cleaned;
    }
  }

  const genericAlertHeader = /^(?:health\s+canada|uk\s+medicines\s+and\s+healthcare\s+products\s+regulatory\s+agency|regulatory\s+agency|mhra|recall|alert|notice|report|shared\s+link|link|filecamp)/i;
  if (!model && !make && genericAlertHeader.test(first)) {
    return '';
  }

  const uppercaseCandidate = filtered.find((line) => /^[A-Z0-9 \/,\-\(\)]+$/.test(line) && !line.includes(':'));
  if (uppercaseCandidate) {
    return uppercaseCandidate;
  }

  if (model) {
    const lowerModel = model.toLowerCase();
    const modelIndex = filtered.findIndex((line) => line.toLowerCase().includes(lowerModel));
    if (modelIndex > 0) {
      return filtered[modelIndex - 1];
    }
  }

  return '';
}

function looksLikeAlertHeadline(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return false;
  }

  const headlinePrefixes = [
    'health canada',
    'uk medicines and healthcare products regulatory agency',
    'uk medicines',
    'regulatory agency',
    'mhra',
    'recalls-rappels.canada.ca',
    'alert-recall',
    'shared link',
    'filecamp',
    'alert',
    'notice',
    'report'
  ];

  return headlinePrefixes.some((prefix) => normalized.toLowerCase().startsWith(prefix));
}

function parseReportFields(formData) {
  const alertText = normalizeAlertLinkText(String(formData.alertText || getAlertTextForScreening() || ''));
  const defaultSource = 'Medical Device Safety Alert report from department of health';
  const serialField = extractReportField(/serial(?: number)?[:\s]*([^\n\.]+)/i, alertText);
  const modelField = extractReportField(/model[:\s]*([^\n\.]+)/i, alertText);
  const makeField = extractPossibleMake(alertText);
  let descriptionField = extractPossibleDescription(alertText, modelField, makeField);
  if (!modelField && descriptionField && descriptionField.trim() === alertText.trim() && looksLikeAlertHeadline(alertText)) {
    descriptionField = '';
  }

  return {
    sourceText: defaultSource,
    issuingAuthority: defaultSource,
    alertCategory: extractReportField(/alert category[:\s]*([^\n\.]+)/i, alertText) || 'N/A',
    affectedDescription: descriptionField || extractReportField(/(?:affected equipment|affected equipment\/system|affected system|equipment\/system|equipment|product|item)[\s:\-]*([^\n\.]+)/i, alertText) || 'N/A',
    affectedManufacturer: makeField || 'N/A',
    affectedModel: modelField || 'N/A',
    serialNumber: serialField || String(formData.serialPart || 'N/A'),
    descriptionOfIssue: extractReportField(/(?:issue|problem|fault|failure|malfunction|defect)[:\s]*([^\n\.]+)/i, alertText) || 'N/A',
    reportedRootCause: extractReportField(/(?:root cause|cause)[:\s]*([^\n\.]+)/i, alertText) || 'N/A'
  };
}

function generateReportForm(formData, reportFields, selectedDevices = []) {
  const sourceText = escapeHtml(reportFields.sourceText);
  const issuingAuthority = escapeHtml(reportFields.issuingAuthority);
  const alertCategory = escapeHtml(reportFields.alertCategory);
  const affectedDescription = escapeHtml(reportFields.affectedDescription);
  const affectedManufacturer = escapeHtml(reportFields.affectedManufacturer);
  const affectedModel = escapeHtml(reportFields.affectedModel);
  const serialNumber = escapeHtml(reportFields.serialNumber);
  const descriptionOfIssue = escapeHtml(reportFields.descriptionOfIssue);
  const reportedRootCause = escapeHtml(reportFields.reportedRootCause);

  return `
    <div class="report">
      <h2 class="report-title">SAFETY CASE ASSESSMENT &amp; PROGRESS REPORT</h2>
      <div class="report-row"><strong>source of information:</strong> ${sourceText}</div>
      <div class="report-row"><strong>Recieved date:</strong> ____________________</div>
      <div class="report-row"><strong>File Ref:</strong> _________________________</div>

      <br/><br/>
      ${selectedDevices.length ? `
      <div class="report-row report-label">Selected devices included in this report:</div>
      <br/>
      <table class="report-table report-selected">
        <thead>
          <tr>
            <th>Serial No.</th>
            <th>Description</th>
            <th>Make</th>
            <th>Model</th>
            <th>Issue</th>
          </tr>
        </thead>
        <tbody>
          ${selectedDevices.map((device) => `
            <tr>
              <td>${escapeHtml(device.id)}</td>
              <td>${escapeHtml(device.description)}</td>
              <td>${escapeHtml(device.manufacturer)}</td>
              <td>${escapeHtml(device.model)}</td>
              <td>${escapeHtml(device.issue)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <br/>
      ` : ''}
      <div class="report-row report-label">Details of safety information:</div>
      <br/>
      <table class="report-table">
        <tbody>
          <tr>
            <td class="part">a.</td>
            <td class="part-content">Issuing authority: ${issuingAuthority}</td>
          </tr>
          <tr>
            <td class="part">b.</td>
            <td class="part-content">Alert category: ${alertCategory}</td>
          </tr>
          <tr>
            <td class="part">c.</td>
            <td class="part-content">Affected equipment/system:
              <ul class="subpoints">
                <li>Description: ${affectedDescription}</li>
                <li>Manufacturer: ${affectedManufacturer}</li>
                <li>Make / model: ${affectedModel}</li>
                <li>Serial No. (if any): ${serialNumber}</li>
              </ul>
            </td>
          </tr>
          <tr>
            <td class="part">d.</td>
            <td class="part-content">Description of issue: ${descriptionOfIssue}</td>
          </tr>
          <tr>
            <td class="part">e.</td>
            <td class="part-content">Reported root cause: ${reportedRootCause}</td>
          </tr>
        </tbody>
      </table>

      <br/><br/>
      <div class="report-row report-underline">prepared by:</div>
      <br/>
      <div class="report-row">Name: _______________________________</div>
      <br/>
      <div class="report-row">Post: ________________________________</div>
      <br/>
      <div class="report-row">Date: ________________________________</div>

      <br/><br/>
      <div class="report-row report-highlight">Endorsed by:</div>
      <br/>
      <div class="report-row">Name: _______________________________</div>
      <br/>
      <div class="report-row">Post: ________________________________</div>
      <br/>
      <div class="report-row">Date: ________________________________</div>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderResult(result, formData) {
  const { matches } = result;
  currentMatches = matches || [];
  selectedDeviceIds.clear();
  reportOutput.innerHTML = '';

  if (!matches.length) {
    resultSummary.innerHTML = '<strong>No clear match.</strong> The alert does not appear to correspond to the current device register.';
    resultTable.innerHTML = '<p role="status">No clear matches found.</p>';
    updateSelectionControls();
    return;
  }

  const matchText = matches.length === 1 ? '1 relevant device identified.' : `${matches.length} relevant devices identified.`;
  resultSummary.innerHTML = `
    <strong>${matchText}</strong><br />
    Source: ${escapeHtml(formData.source || 'not provided')}<br />
    Screening signal: ${matches[0].reasons.join(', ')}<br />
    <div class="selection-hint">Select one or more results to enable report generation.</div>
  `;
  resultTable.innerHTML = buildTable(matches);
  updateSelectionControls();
}

function handleBulkAlertPaste(text) {
  const entries = splitAlertEntries(text);
  if (!entries.length) {
    return [];
  }

  return entries.map((entry) => {
    const criteria = extractAlertCriteria({ alertText: entry, alertHtml: '', link: '', serialPart: '' });
    const result = screenAlert(criteria);
    return {
      entry,
      criteria,
      result
    };
  });
}

resultTable.addEventListener('change', (event) => {
  if (!event.target || !event.target.matches('.select-match')) return;

  const checkbox = event.target;
  const id = checkbox.dataset.id;
  if (checkbox.checked) {
    selectedDeviceIds.add(id);
  } else {
    selectedDeviceIds.delete(id);
  }

  resultTable.innerHTML = buildTable(currentMatches);
  const selected = getSelectedMatches();
  if (selected.length) {
    resultSummary.innerHTML = `<strong>${selected.length} selected.</strong> ${selected.length > 1 ? 'Multiple devices selected for report.' : 'One device selected for report.'}`;
  } else {
    resultSummary.innerHTML = '<div class="selection-hint">Select one or more results to enable report generation.</div>';
  }
  updateSelectionControls();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  resultSummary.innerHTML = '<strong>Loading device register…</strong> Please wait while the registry is prepared.';
  await ensureDeviceRegistryLoaded();

  const formData = getFormData();
  const alertHtmlText = getAlertTextForScreening();
  const alertLinks = [...extractLinksFromHtml(formData.alertHtml), ...extractLinksFromText(alertHtmlText)];
  const normalizedLinks = alertLinks.map((link) => normalizeUrlForScreening(link)).filter(Boolean);
  const pdfText = await getPdfTextForScreening(formData);
  const screeningText = [alertHtmlText, pdfText, ...normalizedLinks].filter(Boolean).join(' ');

  if (!screeningText.trim()) {
    resultSummary.innerHTML = '<strong>Please paste an alert first.</strong>';
    resultTable.innerHTML = '';
    return;
  }

  const splitEntries = splitAlertEntries([alertHtmlText, pdfText].filter(Boolean).join(' '));
  if (splitEntries.length > 1) {
    const bulkResults = splitEntries.map((entry) => {
      const criteria = extractAlertCriteria({ ...formData, alertText: entry });
      const result = screenAlert(criteria);
      return { entry, result };
    });

    const matchedEntries = bulkResults.filter(({ result }) => result.matches.length);
    if (matchedEntries.length) {
      const combinedMatches = matchedEntries.flatMap(({ result }) => result.matches);
      const uniqueMatches = combinedMatches.filter((device, index, array) => array.findIndex((candidate) => candidate.id === device.id) === index);
      renderResult({ matches: uniqueMatches.slice(0, 8) }, formData);
      return;
    }
  }

  const criteria = extractAlertCriteria({
    ...formData,
    alertText: [alertHtmlText, pdfText].filter(Boolean).join(' ')
  });

  const result = screenAlert(criteria);
  renderResult(result, formData);
});

copyButton.addEventListener('click', () => {
  const formData = getFormData();

  if (!formData.alertText.trim()) {
    resultSummary.innerHTML = '<strong>Please paste an alert first.</strong>';
    return;
  }

  const selected = getSelectedMatches();
  if (!selected.length) {
    resultSummary.innerHTML = '<strong>Please select one or more result to export to Excel.</strong>';
    return;
  }

  const html = buildExcelHtml(selected);
  downloadFile('device-screening-export.xls', html, 'application/vnd.ms-excel;charset=utf-8;');
  resultSummary.innerHTML = '<strong>Excel file downloaded.</strong> Open it in Excel to view the selected matches.';
});

exportPdfButton.addEventListener('click', () => {
  const currentReport = reportOutput.innerHTML.trim();
  const selected = getSelectedMatches();
  if (!currentReport || !selected.length) {
    resultSummary.innerHTML = '<strong>Please select one or more results and generate a report first.</strong>';
    return;
  }

  document.body.classList.add('print-report');
  window.onafterprint = () => {
    document.body.classList.remove('print-report');
    window.onafterprint = null;
  };

  setTimeout(() => {
    window.print();
  }, 120);
});

generateReportButton.addEventListener('click', () => {
  const formData = getFormData();

  const selected = getSelectedMatches();
  if (!selected.length) {
    reportOutput.innerHTML = '';
    resultSummary.innerHTML = '<strong>Please select one or more results.</strong> The report cannot be generated until at least one screening result is selected.';
    return;
  }

  const reportFields = parseReportFields(formData);
  reportOutput.innerHTML = generateReportForm(formData, reportFields, selected);
  resultSummary.innerHTML = `<strong>Report form generated.</strong> ${selected.length} result${selected.length === 1 ? '' : 's'} included in the report and PDF export.`;
  updateSelectionControls();
});

useExampleButton.addEventListener('click', () => {
  document.getElementById('source').value = 'TGA';
  document.getElementById('link').value = 'https://apps.tga.gov.au/PROD/DRAC/arn-entry.aspx';
  document.getElementById('serialPart').value = 'LCSU 4';
  setAlertHtml(`TGA Safety Alert: Laerdal airway aspirators. The service life of LCSU 4 units manufactured between 9 August 2018 and 6 June 2020 may be reduced due to weakness in the design and assembly process. The pump may malfunction resulting in low suction levels or failure to provide suction.`);
});

clearFormButton.addEventListener('click', () => {
  form.reset();
  setAlertHtml('');
  document.getElementById('source').value = '';
  reportOutput.innerHTML = '';
  currentMatches = [];
  selectedDeviceIds.clear();
  resultSummary.innerHTML = 'No screening has been run yet.';
  resultTable.innerHTML = '';
  updateSelectionControls();
});

generateReportButton.disabled = true;
exportPdfButton.disabled = true;
loadDeviceRegistry();

// Click-to-screen: clicking a match row will populate the form and re-run screening
resultTable.addEventListener('click', (e) => {
  if (e.target && e.target.closest && e.target.closest('input.select-match')) return;
  const tr = e.target.closest && e.target.closest('tr.match-row');
  if (!tr) return;
  const id = tr.dataset.id || '';
  const description = tr.dataset.description || '';

  const serialInput = document.getElementById('serialPart');
  const alertInput = document.getElementById('alertText');
  if (serialInput) serialInput.value = id;
  if (alertInput) setAlertHtml(escapeHtml(description));

  const formData = {
    source: document.getElementById('source').value,
    link: document.getElementById('link').value,
    serialPart: serialInput ? serialInput.value : id,
    alertText: getAlertText(),
    alertHtml: getAlertHtml()
  };

const criteria = extractAlertCriteria(formData);
    const result = screenAlert(criteria);
  renderResult(result, formData);
  resultSummary.innerHTML = '<strong>Screened selected device.</strong>';
});
