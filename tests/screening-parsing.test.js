const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadScreeningScript() {
  const scriptPath = path.join(__dirname, '..', 'medical-device-main', 'medical-device-main', 'medical-device-data-base-gh-pages', 'script.js');
  const source = fs.readFileSync(scriptPath, 'utf8');

  const elements = new Map();
  const createElement = () => ({
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    classList: { add() {}, remove() {} },
    addEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    querySelectorAll() { return []; },
    appendChild() {},
    removeChild() {},
    click() {},
    matches() { return false; },
    closest() { return null; },
    focus() {}
  });

  const formElement = createElement();
  formElement.addEventListener = () => {};
  const commonElement = createElement();
  commonElement.addEventListener = () => {};

  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createElement());
      }
      return elements.get(id);
    },
    createElement(tagName) {
      if (tagName === 'div') {
        return createElement();
      }
      return createElement();
    },
    body: createElement(),
    addEventListener() {}
  };

  const context = {
    console,
    document,
    window: {},
    setTimeout,
    clearTimeout,
    URL,
    Blob,
    FileReader: class {},
    navigator: { userAgent: 'node' },
    fetch: async () => ({ ok: true, json: async () => ({ records: [] }) })
  };
  context.window = context;
  context.globalThis = context;
  context.document.defaultView = context.window;

  vm.createContext(context);
  vm.runInContext(source, context, { filename: scriptPath });
  return context;
}

test('extractPossibleDescription prefers product labels from alert content', () => {
  const context = loadScreeningScript();

  const sampleText = [
    'Affected product:',
    'CyberKnife Treatment Delivery Systems',
    'Manufacturer: Accuray',
    'Model: G4'
  ].join('\n');

  const description = context.extractPossibleDescription(sampleText, 'G4', 'Accuray');

  assert.equal(description, 'CyberKnife Treatment Delivery Systems');
});

test('extractPossibleDescription handles product device name labels from PDF content', () => {
  const context = loadScreeningScript();

  const sampleText = [
    'Product/Device name: Balt Extrusion HYBRID',
    'Manufacturer: Balt Extrusion',
    'Model: Hybrid 1'
  ].join('\n');

  const description = context.extractPossibleDescription(sampleText, 'Hybrid 1', 'Balt Extrusion');

  assert.equal(description, 'Balt Extrusion HYBRID');
});

test('extractAlertCriteria infers CyberKnife manufacturer and model from alert text', () => {
  const context = loadScreeningScript();
  const payload = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'medical-device-main', 'medical-device-main', 'medical-device-data-base-gh-pages', 'devices.json'), 'utf8'));
  const cyberKnifeRecord = (payload.records || []).find((record) => String(record.model || '').toLowerCase().includes('cyberknife'));
  const mappedRegistry = (payload.records || []).map((record, index) => context.toDeviceRecord(record, index));
  vm.runInContext(`deviceRegistry = ${JSON.stringify(mappedRegistry)};`, context);

  const criteria = context.extractAlertCriteria({
    alertText: 'UK Medicines and Healthcare products Regulatory Agency (MHRA): Accuray CyberKnife',
    alertHtml: '',
    link: 'https://mhra-gov.filecamp.com/s/d/chWFJPPib8KWWNZj',
    serialPart: ''
  });

  assert.match(criteria.make.toLowerCase(), /accuray/i);
  assert.match(criteria.model.toLowerCase(), /cyberknife/i);

  const result = context.screenAlert(criteria);
  const cyberKnifeMatch = result.matches.find((match) => match.id === cyberKnifeRecord.no);

  assert.ok(cyberKnifeMatch, 'expected a CyberKnife match to be returned');
  assert.match(cyberKnifeMatch.manufacturer.toLowerCase(), /accuray/i);
});

test('splitAlertEntries handles numbered alert lists', () => {
  const context = loadScreeningScript();
  const combinedText = [
    '1. Health Canada: Stryker GmbH Hoffmann II Carbon Connecting Rod',
    '2. UK Medicines and Healthcare products Regulatory Agency (MHRA): Accuray CyberKnife',
    '3. Australia TGA: Olympus UHI-4 High Flow Insufflation Unit'
  ].join('\n');

  const entries = context.splitAlertEntries(combinedText);
  assert.equal(entries.length, 3);
  assert.equal(entries[0], 'Health Canada: Stryker GmbH Hoffmann II Carbon Connecting Rod');
  assert.equal(entries[1], 'UK Medicines and Healthcare products Regulatory Agency (MHRA): Accuray CyberKnife');
  assert.equal(entries[2], 'Australia TGA: Olympus UHI-4 High Flow Insufflation Unit');
});

test('extractAlertCriteria detects Balt Extrusion HYBRID and returns a registry match', () => {
  const context = loadScreeningScript();
  const payload = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'medical-device-main', 'medical-device-main', 'medical-device-data-base-gh-pages', 'devices.json'), 'utf8'));
  const mappedRegistry = (payload.records || []).map((record, index) => context.toDeviceRecord(record, index));
  vm.runInContext(`deviceRegistry = ${JSON.stringify(mappedRegistry)};`, context);

  const criteria = context.extractAlertCriteria({
    alertText: 'UK Medicines and Healthcare products Regulatory Agency (MHRA): Balt Extrusion HYBRID',
    alertHtml: '',
    link: 'https://mhra-gov.filecamp.com/s/d/vexiwH1Duw6cirFM',
    serialPart: ''
  });

  assert.match(criteria.make.toLowerCase(), /balt extrusion/i);
  assert.match(criteria.model.toLowerCase(), /hybrid/i);

  const result = context.screenAlert(criteria);
  assert.ok(result.matches.length > 0, 'expected Balt Extrusion HYBRID to match at least one database record');
  assert.ok(result.matches.some((match) => String(match.manufacturer || '').toLowerCase().includes('balt')));
});

test('extractAlertCriteria detects Integra Omni-Tract retractor alerts and returns a registry match', () => {
  const context = loadScreeningScript();
  const payload = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'medical-device-main', 'medical-device-main', 'medical-device-data-base-gh-pages', 'devices.json'), 'utf8'));
  const mappedRegistry = (payload.records || []).map((record, index) => context.toDeviceRecord(record, index));
  vm.runInContext(`deviceRegistry = ${JSON.stringify(mappedRegistry)};`, context);

  const criteria = context.extractAlertCriteria({
    alertText: 'UK Medicines and Healthcare products Regulatory Agency (MHRA): Integra LifeSciences IntegraOmni-Tract Table Mounted Retractor System',
    alertHtml: '',
    link: 'https://mhra-gov.filecamp.com/s/d/ku1NzK8ZuHySAEFk',
    serialPart: ''
  });

  assert.match(criteria.make.toLowerCase(), /integra/i);
  assert.match(criteria.model.toLowerCase(), /omni/i);

  const result = context.screenAlert(criteria);
  assert.ok(result.matches.length > 0, 'expected Integra Omni-Tract to match at least one database record');
  assert.ok(result.matches.some((match) => String(match.description || '').toLowerCase().includes('retractor')));
});

test('findKnownAlertMatches returns explicit matches for the reported MHRA alerts', () => {
  const context = loadScreeningScript();
  const payload = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'medical-device-main', 'medical-device-main', 'medical-device-data-base-gh-pages', 'devices.json'), 'utf8'));
  const mappedRegistry = (payload.records || []).map((record, index) => context.toDeviceRecord(record, index));
  vm.runInContext(`deviceRegistry = ${JSON.stringify(mappedRegistry)};`, context);

  const baltMatches = context.findKnownAlertMatches('UK Medicines and Healthcare products Regulatory Agency (MHRA): Balt Extrusion HYBRID');
  const integraMatches = context.findKnownAlertMatches('UK Medicines and Healthcare products Regulatory Agency (MHRA): Integra LifeSciences IntegraOmni-Tract Table Mounted Retractor System');

  assert.ok(baltMatches.some((match) => String(match.id) === '110407' || String(match.id) === '210339'));
  assert.ok(integraMatches.some((match) => String(match.id) === '253751'));
});

test('screenAlert returns a match for the Stryker 1788 4K camera alert example', () => {
  const context = loadScreeningScript();
  const payload = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'medical-device-main', 'medical-device-main', 'medical-device-data-base-gh-pages', 'devices.json'), 'utf8'));
  const mappedRegistry = (payload.records || []).map((record, index) => context.toDeviceRecord(record, index));
  vm.runInContext(`deviceRegistry = ${JSON.stringify(mappedRegistry)};`, context);

  const criteria = context.extractAlertCriteria({
    alertText: 'Health Canada: Stryker Endoscopy, a Div. of Stryker Corp. dba Stryker Endoscopy 1788 4K Camera',
    alertHtml: '',
    link: 'https://recalls-rappels.canada.ca/en/alert-recall/1788-4k-camera',
    serialPart: ''
  });

  const result = context.screenAlert(criteria);
  assert.ok(result.matches.length > 0, 'expected a Stryker 1788 4K camera match to be returned');
  assert.ok(result.matches.some((match) => String(match.manufacturer || '').toLowerCase().includes('stryker')));
});

test('screenAlert returns no matches for the non-matching TGA and Health Canada examples', () => {
  const context = loadScreeningScript();
  const payload = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'medical-device-main', 'medical-device-main', 'medical-device-data-base-gh-pages', 'devices.json'), 'utf8'));
  const mappedRegistry = (payload.records || []).map((record, index) => context.toDeviceRecord(record, index));
  vm.runInContext(`deviceRegistry = ${JSON.stringify(mappedRegistry)};`, context);

  const alerts = [
    'Australia TGA: Getinge Percutaneous Insertion Kits (PIK)',
    'Australia TGA: Boston Scientific LATITUDE Clarity Server Software',
    'Health Canada: Biofire Defense LLC FilmArray NGDS Warrior Panel',
    'Health Canada: Canadian Hospital Specialties Ltd. Doing Business As CHS Med-RX Wound Care Kits'
  ];

  for (const alertText of alerts) {
    const criteria = context.extractAlertCriteria({ alertText, alertHtml: '', link: '', serialPart: '' });
    const result = context.screenAlert(criteria);
    assert.equal(result.matches.length, 0, `expected no matches for ${alertText}`);
  }
});

test('screenAlert requires description, make, and model to align before returning a match', () => {
  const context = loadScreeningScript();
  const payload = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'medical-device-main', 'medical-device-main', 'medical-device-data-base-gh-pages', 'devices.json'), 'utf8'));
  const mappedRegistry = (payload.records || []).map((record, index) => context.toDeviceRecord(record, index));
  vm.runInContext(`deviceRegistry = ${JSON.stringify(mappedRegistry)};`, context);

  const noMatchAlerts = [
    'Health Canada: Stryker GmbH Hoffmann II Carbon Connecting Rod',
    'UK Medicines and Healthcare products Regulatory Agency (MHRA): Doccla Passive Monitoring section of the CSCR (V2.15)',
    'UK Medicines and Healthcare products Regulatory Agency (MHRA): GE Healthcare Carestation 600 and 750 Series',
    'UK Medicines and Healthcare products Regulatory Agency (MHRA): Intersurgical One-piece Guedel airway',
    'UK Medicines and Healthcare products Regulatory Agency (MHRA): Medtronic Sphere-9 catheter',
    'UK Medicines and Healthcare products Regulatory Agency (MHRA): Olympus High Flow Insufflation Unit',
    'UK Medicines and Healthcare products Regulatory Agency (MHRA): Symbios Orthopedie CoCr Modular Neck assembled with SPS Modular Stem'
  ];

  for (const alertText of noMatchAlerts) {
    const criteria = context.extractAlertCriteria({ alertText, alertHtml: '', link: '', serialPart: '' });
    const result = context.screenAlert(criteria);
    assert.equal(result.matches.length, 0, `Expected no matches for alert: ${alertText}`);
  }

  const positiveAlerts = [
    {
      alertText: 'Health Canada: Zimmer Surgical, Inc. Also Trading As Relign Corporation A.T.S 4000 TS Tourniquet Systems Single and Dual Hose with CPC Connectors',
      expectedTokens: ['zimmer', 'tourniquet']
    },
    {
      alertText: 'Health Canada: Ge Medical Systems, LLC Optima XR240amx X-Ray System',
      expectedTokens: ['optima', 'xr240amx']
    },
    {
      alertText: 'Australia TGA: Werfen HemosIL AcuStar ADAMTS13 Activity',
      expectedTokens: ['hemosil', 'acustar']
    },
    {
      alertText: 'Australia TGA: Olympus UHI-4 High Flow Insufflation Unit',
      expectedTokens: ['olympus', 'insufflation', 'uhi']
    },
    {
      alertText: 'UK Medicines and Healthcare products Regulatory Agency (MHRA): Accuray CyberKnife',
      expectedTokens: ['accuray', 'cyberknife']
    },
    {
      alertText: 'UK Medicines and Healthcare products Regulatory Agency (MHRA): Balt Extrusion HYBRID',
      expectedTokens: ['balt', 'hybrid']
    },
    {
      alertText: 'UK Medicines and Healthcare products Regulatory Agency (MHRA): Integra LifeSciences IntegraOmni-Tract Table Mounted Retractor System',
      expectedTokens: ['integra', 'omni']
    },
    {
      alertText: 'UK Medicines and Healthcare products Regulatory Agency (MHRA): Philips BiPAP A30(Hybrid)/A40/A40Pro Ventilator(Res.,Inc.)',
      expectedTokens: ['bipap', 'philips']
    },
    {
      alertText: 'UK Medicines and Healthcare products Regulatory Agency (MHRA): Siemens Healthcare Atellica CI Analyzer, Atellica IM Analyzer, ADVIA Centaur XP System, ADVIA Centaur XPT System, ADVIA Centaur CP System',
      expectedTokens: ['atellica', 'siemens']
    }
  ];

  for (const { alertText, expectedTokens } of positiveAlerts) {
    const criteria = context.extractAlertCriteria({ alertText, alertHtml: '', link: '', serialPart: '' });
    const result = context.screenAlert(criteria);
    assert.ok(result.matches.length > 0, `Expected at least one match for alert: ${alertText}`);

    const joined = result.matches
      .map((match) => `${match.description} ${match.manufacturer} ${match.model}`.toLowerCase())
      .join(' ');
    const matchedAnyToken = expectedTokens.some((token) => joined.includes(token));
    assert.ok(matchedAnyToken, `Expected one of ${expectedTokens.join(', ')} in the matched results for ${alertText}`);
  }
});
