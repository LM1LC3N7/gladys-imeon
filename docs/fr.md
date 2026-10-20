# IMEON pour Gladys Assistant

Intégration **non officielle**, sans lien avec Imeon Energy. Elle lit votre
onduleur hybride IMEON (IMEON 3.6, 9.12, 3-25…) sur votre réseau local, par
l'API locale d'OS One, sans cloud, une fois par minute. **Lecture seule** :
elle ne change jamais un réglage de l'onduleur (mode, charge de la batterie,
injection, relais).

**Jamais testé avec un vrai onduleur IMEON** : l'intégration a été écrite à
partir de la bibliothèque officielle d'Imeon Energy (imeon_inverter_api) et
de l'intégration Home Assistant qui l'utilise. Vos retours sont les bienvenus.

## Prérequis

- Un onduleur IMEON avec OS One, joignable sur votre réseau local (adresse
  IP fixe conseillée dans votre box).
- Le **module API** activé sur l'onduleur (sans lui, l'intégration indique
  « réponse qui n'est pas celle d'un IMEON »).
- L'identifiant et le mot de passe de l'interface locale de l'onduleur (souvent
  `user@local`). Un compte utilisateur suffit : l'intégration ne fait que lire.

## Configuration

1. Dans Gladys, installez l'intégration IMEON depuis le catalogue.
2. Saisissez l'**adresse** de l'onduleur (ex. `192.168.1.50`), l'**identifiant**
   et le **mot de passe**. Le mot de passe est gardé par Gladys dans sa base,
   jamais réaffiché, envoyé seulement à l'onduleur sur votre réseau.
3. Cliquez sur **Tester la connexion** : le modèle et le numéro de série de
   l'onduleur s'affichent.
4. Dans l'onglet **Découverte**, créez l'appareil « IMEON … ». Ses valeurs
   arrivent aussitôt, puis chaque minute.

## Ce que vous obtenez

- **Solaire** : production totale (`energy-production-sensor`, W), par
  chaîne, part consommée dans la maison, part injectée.
- **Batterie** : charge (%), puissance, état (1 = en charge, 2 = en décharge,
  3 = chargée), puissances stockée et consommée.
- **Réseau** : puissance prélevée (`energy-sensor`, W, lue par les contrats
  d'énergie), puissance injectée, flux, tension et courant par phase,
  fréquence.
- **Maison** : consommation (W), entrée et sortie AC, compteur d'énergie,
  températures de l'onduleur, autoconsommation et autosuffisance sur 24 h,
  état et mode de l'onduleur (en lecture seule), limites de courant de
  charge et de puissance d'injection.
- **Compteurs du jour** (kWh) : production solaire, prélevé et injecté sur le
  réseau, consommation de la maison, stocké dans et pris à la batterie,
  prévisions restantes. Ce sont de simples capteurs : ils repartent de 0
  chaque nuit et ne sont jamais comptés par le suivi énergétique.
- **Deux index d'énergie** pour le suivi énergétique de Gladys : l'index de
  **consommation réseau** (le cœur en tire la consommation et son coût) et
  l'index de **production solaire** (le cœur en tire la production par
  demi-heure).

Les phases L2 et L3 n'apparaissent qu'une fois que l'onduleur les montre
(onduleur triphasé).

## Les index d'énergie

L'API locale de l'onduleur ne donne que des **compteurs du jour**, qui
repartent de 0 à minuit, et aucun compteur cumulé. Le suivi énergétique de
Gladys a besoin d'un index cumulé. L'intégration le construit donc :
index = somme des journées terminées + compteur du jour.

- Quand le compteur du jour repart de presque 0 (au plus 36 kWh), au moins
  12 h après le précédent, c'est un nouveau jour : l'index continue sans
  baisser. Ce que l'onduleur a compté entre la dernière lecture et son minuit
  (une minute au plus) est perdu : un peu moins est compté, jamais plus.
- Une autre baisse du compteur est un incident : pas d'index tant que le
  compteur n'est pas revenu au-dessus de sa dernière valeur (l'état le dit).
- Si le compteur retombe à 0 puis revient aussitôt à son niveau (plus vite
  que possible), le « nouveau jour » est annulé.
- Si l'intégration est arrêtée plusieurs heures autour de minuit, l'énergie
  de ces heures n'est pas comptée.

Chaque index passe ensuite la **garde** reprise de l'intégration P1 Monitor :
jamais 0 ; une hausse plausible (au plus 36 kW en moyenne depuis la dernière
valeur, plus 0,5 kWh) passe ; une baisse ou un saut est **retenu** (la
dernière valeur acceptée est renvoyée), affiché dans l'état de l'intégration
et gardé après un redémarrage. Seul le bouton **Accepter l'index retenu** le
prend, et seulement pour la valeur affichée (plus ce qui a pu venir depuis) :
un saut est alors compté d'un coup, une baisse ne compte rien. Enregistrer la
configuration n'accepte jamais rien.

Si vous supprimez puis recréez l'appareil, ses index repartent de zéro.

## Erreurs et pauses

- **Identifiant ou mot de passe refusé** : les lectures s'arrêtent (gardé
  après un redémarrage), un seul nouvel essai après 1 h, puis 2 h… jusqu'à
  24 h. Corrigez-les et enregistrez la configuration pour repartir aussitôt.
  Le bouton de test ne force jamais d'essai pendant cet arrêt.
- **HTTP 429 ou 5xx** : pause de 1 minute à 6 heures (gardée après un
  redémarrage), jamais de lecture avant la fin.
- **Onduleur injoignable** : nouvel essai après 1 minute, puis doublé jusqu'à
  15 minutes.
- **Session terminée** : l'intégration se reconnecte une seule fois par
  lecture, jamais en boucle.
- Une page secondaire (températures, prévisions, état…) qui ne répond pas ne
  bloque jamais les autres valeurs.

## Limites connues

- Jamais testé avec un vrai onduleur IMEON : les noms des champs et leurs
  unités viennent de la bibliothèque et de l'intégration Home Assistant.
- Lecture seule en v0.1 : pas de changement de mode, de charge réseau, de
  décharge nocturne, d'injection ni de relais.
- Les messages de la chronologie de l'onduleur ne sont pas lus en v0.1.
- Un seul onduleur par intégration.

## Données et vie privée

Tout reste sur votre réseau local : l'intégration ne parle qu'à l'onduleur.
Le dossier `/data` de l'intégration ne garde que le numéro de série, l'état
des index et des gardes, et les pauses en cours : jamais le mot de passe ni le
cookie de session.
