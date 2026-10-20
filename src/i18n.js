// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object. They
// never quote a text of the inverter, nor the user name or the password:
// only our own words and error codes.
// -----------------------------------------------------------------------------

const seconds = (ms) => Math.max(1, Math.round(ms / 1000));
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
const hours = (ms) => Math.max(1, Math.round(ms / 3_600_000));
const delay = (ms) => {
  if (ms >= 2 * 3_600_000) return { en: `${hours(ms)} h`, fr: `${hours(ms)} h` };
  if (ms >= 60_000) return { en: `${minutes(ms)} min`, fr: `${minutes(ms)} min` };
  return { en: `${seconds(ms)} s`, fr: `${seconds(ms)} s` };
};

/** Our words for an error code of src/imeon/client.js. */
const REASON = {
  timeout: { en: 'no answer', fr: 'pas de réponse' },
  unreachable: { en: 'unreachable', fr: 'injoignable' },
  http: { en: 'HTTP error', fr: 'erreur HTTP' },
  server: { en: 'error of the inverter', fr: 'erreur de l’onduleur' },
  rate_limited: { en: 'too many requests', fr: 'trop de requêtes' },
  too_large: { en: 'answer too large', fr: 'réponse trop grande' },
  not_data: { en: 'answer that is not data', fr: 'réponse qui n’est pas une donnée' },
  unknown_answer: {
    en: 'not an IMEON answer (is the API module of the inverter turned on?)',
    fr: 'réponse qui n’est pas celle d’un IMEON (le module API de l’onduleur est-il activé ?)',
  },
  login_required: {
    en: 'the session of the inverter ended again right after a login',
    fr: 'la session de l’onduleur s’est terminée juste après une connexion',
  },
};

export function reason(err) {
  const text = REASON[err?.code] ?? { en: 'unexpected error', fr: 'erreur inattendue' };
  const status =
    (err?.code === 'http' || err?.code === 'server') && err.status ? ` ${err.status}` : '';
  return { en: `${text.en}${status}`, fr: `${text.fr}${status}` };
}

/** The names of the secondary pages, for the status. */
const PAGE = {
  input: { en: 'AC input', fr: 'entrée AC' },
  output: { en: 'AC output', fr: 'sortie AC' },
  meter: { en: 'energy meter', fr: 'compteur d’énergie' },
  temp: { en: 'temperatures', fr: 'températures' },
  forecast: { en: 'forecast', fr: 'prévisions' },
  monitoring: { en: '24 h figures', fr: 'valeurs sur 24 h' },
  manager: { en: 'state and mode', fr: 'état et mode' },
  data: { en: 'serial and limits', fr: 'numéro de série et limites' },
};

const INDEX = {
  consumption: { en: 'grid consumption index', fr: 'index de consommation réseau' },
  production: { en: 'solar production index', fr: 'index de production solaire' },
};

const kwh = (value) => Math.round(value * 1000) / 1000;

const join = (lang, first, notes) => [first[lang], ...notes.map((n) => n[lang])].join(' ');

export const T = {
  incomplete: {
    en: 'Enter the address of your IMEON inverter (its IP address on your network, e.g. 192.168.1.50), the user name and the password of its local interface.',
    fr: 'Saisissez l’adresse de votre onduleur IMEON (son adresse IP sur votre réseau, ex. 192.168.1.50), l’identifiant et le mot de passe de son interface locale.',
  },
  badAddress: {
    en: 'The inverter address is not valid: enter an IP address or a host name, with an optional port (e.g. 192.168.1.50).',
    fr: 'L’adresse de l’onduleur n’est pas valide : saisissez une adresse IP ou un nom d’hôte, avec un port éventuel (ex. 192.168.1.50).',
  },
  /** `notes`: { en, fr } texts added after the failure (an index held back). */
  unreachable: (address, err, wait, notes = []) => {
    const first = {
      en: `The IMEON inverter at ${address} could not be read (${reason(err).en}): new try in ${delay(wait).en}.`,
      fr: `L’onduleur IMEON à l’adresse ${address} n’a pas pu être lu (${reason(err).fr}) : nouvel essai dans ${delay(wait).fr}.`,
    };
    return { en: join('en', first, notes), fr: join('fr', first, notes) };
  },
  /** HTTP 429 or 5xx: a pause, kept across restarts. */
  paused: (address, err, wait, notes = []) => {
    const first = {
      en: `The IMEON inverter at ${address} asks to wait (${reason(err).en}): reads paused, new try in ${delay(wait).en}.`,
      fr: `L’onduleur IMEON à l’adresse ${address} demande d’attendre (${reason(err).fr}) : lectures en pause, nouvel essai dans ${delay(wait).fr}.`,
    };
    return { en: join('en', first, notes), fr: join('fr', first, notes) };
  },
  /** The credentials refused: stopped, kept across restarts. */
  authRefused: (wait, notes = []) => {
    const first = {
      en: `The inverter refused the user name or the password: reads stopped. Correct them and save the configuration; otherwise one new try in ${delay(wait).en}.`,
      fr: `L’onduleur a refusé l’identifiant ou le mot de passe : lectures arrêtées. Corrigez-les et enregistrez la configuration ; sinon un seul nouvel essai dans ${delay(wait).fr}.`,
    };
    return { en: join('en', first, notes), fr: join('fr', first, notes) };
  },
  noDevice: {
    en: 'IMEON inverter found: create its device from the "Discover" tab to receive its values.',
    fr: 'Onduleur IMEON trouvé : créez son appareil depuis l’onglet « Découverte » pour recevoir ses valeurs.',
  },
  /** `notes`: { en, fr } texts added after the connection message. */
  ok: (address, notes = []) => {
    const first = {
      en: `Connected to the IMEON inverter (${address}).`,
      fr: `Connecté à l’onduleur IMEON (${address}).`,
    };
    return { en: join('en', first, notes), fr: join('fr', first, notes) };
  },
  notes: {
    pages: (pages) => ({
      en: `Some pages do not answer (${pages.map((p) => PAGE[p].en).join(', ')}): the other values go on.`,
      fr: `Certaines pages ne répondent pas (${pages.map((p) => PAGE[p].fr).join(', ')}) : les autres valeurs continuent.`,
    }),
    noIndex: (names) => ({
      en: `The counter of the day dropped without a new day (${names.map((n) => INDEX[n].en).join(', ')}): no index until it is back above its last value.`,
      fr: `Le compteur du jour a baissé sans nouveau jour (${names.map((n) => INDEX[n].fr).join(', ')}) : pas d’index tant qu’il n’est pas revenu au-dessus de sa dernière valeur.`,
    }),
    held: (name, { direction, from, to }) => {
      const index = INDEX[name];
      if (direction === 'down') {
        return {
          en: `The ${index.en} dropped from ${kwh(from)} to ${kwh(to)} kWh: held back, the last accepted value is sent again. If it is right, click "Accept the held index" in the configuration of the integration: nothing is counted for the drop, the index goes on from there. Saving the configuration accepts nothing.`,
          fr: `L’${index.fr} a baissé de ${kwh(from)} à ${kwh(to)} kWh : retenu, la dernière valeur acceptée est renvoyée. Si c’est juste, cliquez sur « Accepter l’index retenu » dans la configuration de l’intégration : rien n’est compté pour la baisse, l’index repart de là. Enregistrer la configuration n’accepte rien.`,
        };
      }
      const diff = kwh(to - from);
      return {
        en: `The ${index.en} jumped from ${kwh(from)} to ${kwh(to)} kWh: held back, not sent to the energy monitoring. If you click "Accept the held index" in the configuration of the integration, ${diff} kWh will be counted at once; accept only if this energy was real. Saving the configuration accepts nothing.`,
        fr: `L’${index.fr} a sauté de ${kwh(from)} à ${kwh(to)} kWh : retenu, non envoyé au suivi énergétique. Si vous cliquez sur « Accepter l’index retenu » dans la configuration de l’intégration, ${diff} kWh seront comptés d’un coup ; n’acceptez que si cette énergie est réelle. Enregistrer la configuration n’accepte rien.`,
      };
    },
  },
  accept: {
    nothing: {
      en: 'No index is held back: nothing to accept.',
      fr: 'Aucun index n’est retenu : rien à accepter.',
    },
    /** `accepted`: [{ name, direction, from, to }]. */
    done: (accepted) => ({
      en: accepted
        .map(({ name, direction, from, to }) =>
          direction === 'down'
            ? `Accepted: the ${INDEX[name].en} goes from ${kwh(from)} down to ${kwh(to)} kWh at the next read; 0 kWh is counted for the drop.`
            : `Accepted: the ${INDEX[name].en} ${kwh(to)} kWh will be sent at the next read, and ${kwh(to - from)} kWh (plus what comes meanwhile) will be counted at once.`,
        )
        .concat('A different value stays held.')
        .join(' '),
      fr: accepted
        .map(({ name, direction, from, to }) =>
          direction === 'down'
            ? `Accepté : l’${INDEX[name].fr} passe de ${kwh(from)} à ${kwh(to)} kWh à la prochaine lecture ; 0 kWh est compté pour la baisse.`
            : `Accepté : l’${INDEX[name].fr} ${kwh(to)} kWh sera envoyé à la prochaine lecture, et ${kwh(to - from)} kWh (plus ce qui vient d’ici là) seront comptés d’un coup.`,
        )
        .concat('Une autre valeur reste retenue.')
        .join(' '),
    }),
  },
  test: {
    ok: (info) => ({
      en: `IMEON inverter read: ${['IMEON', info.model].filter(Boolean).join(' ')}, serial ${info.serial}.`,
      fr: `Onduleur IMEON lu : ${['IMEON', info.model].filter(Boolean).join(' ')}, numéro de série ${info.serial}.`,
    }),
    slow: {
      en: 'The inverter is slow to answer: look at the integration status in a minute.',
      fr: 'L’onduleur tarde à répondre : regardez l’état de l’intégration dans une minute.',
    },
  },
};
