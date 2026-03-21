# Προτάσεις: Generic ESPHome (full easy) + Γενικές βελτιώσεις

**Στόχος:** Ο χρήστης να μπορεί πολύ εύκολα να βάλει YAML και να κάνει μετά add peripherals, χωρίς να χάνονται σε πολλά βήματα.

---

## Α. Generic ESPHome — «Full easy» flow

### Τι υπάρχει τώρα

1. **Import Board from YAML** → Paste → Parse → Save as board profile.
2. Μετά: Step 1 (Setup) → Step 2 (Device: διάλεξε board από dropdown) → Step 3 (Network) → Step 4 (Entities) → Step 5 (Flash).
3. **Add to Device** = πρόσθεσε sensor σε **ήδη flashed** συσκευή (OTA).

**Πρόβλημα:** Πολλά βήματα, ο χρήστης δεν βλέπει αμέσως ότι το imported YAML είναι το «board» στο Step 2. Το «add peripheral» υπάρχει μόνο μετά το flash (OTA).

---

### Πρόταση 1: Dedicated «Use my YAML» flow (single path)

**Ιδέα:** Ένα ξεχωριστό flow για «έχω ήδη YAML, θέλω απλά device name + WiFi + MQTT + flash».

- **Είσοδος:** Κουμπί π.χ. **«Use my YAML»** ή **«Paste & Flash»** (δίπλα στο Import Board from YAML).
- **Βήμα 1 — Paste**
  - Textarea: paste YAML (ή URL).
  - Parse (ίδιο API `parse-yaml`).
  - Εμφάνιση preview: name, board, entities που βρέθηκαν.
- **Βήμα 2 — (Προαιρετικό) Add peripherals**
  - Κουμπί «Add sensor / peripheral».
  - Ίδια λογική με το τωρινό «Add to Device»: type (DS18B20, DHT, analog, pulse_counter), pin, name, key.
  - Backend: `addPeripheralToYaml` πάνω στο **τρέχον draft YAML** (δεν χρειάζεται device_id / IP).
  - Μπορεί να προστίθενται πολλά peripherals πριν το flash.
- **Βήμα 3 — Device name & network**
  - Device name (safe name).
  - WiFi SSID / Password (αν χρειάζεται).
  - MQTT Broker.
  - USB port ή OTA IP (αν re-flash).
- **Βήμα 4 — Flash**
  - Generate final YAML (merge substitutions: name, wifi, mqtt) και flash (ίδιο `/api/esphome/flash` ή νέο endpoint που δέχεται `yaml_text` αντί για profile id).

**Backend αλλαγές (ενδεικτικά):**

- Νέο endpoint π.χ. `POST /api/esphome/flash-from-yaml` που δέχεται:
  - `yaml_text` (ή `parsed` profile object),
  - `payload`: device_name, wifi_ssid, wifi_pass, mqtt_host, port / ip.
- Ή επέκταση του υπάρχοντος `resolveConfig` ώστε να δέχεται και «raw yaml + overrides» χωρίς να υπάρχει καταχωρημένο board profile.

**Αποτέλεσμα:** Ο χρήστης δεν χρειάζεται να «Save Board Profile» και να ψάξει στο dropdown. Ενα flow: paste → (optional add peripherals) → name + network → flash.

---

### Πρόταση 2: Μετά το «Import YAML» — άμεσο «Continue to Flash»

Μετά το **Save Board Profile** στο τωρινό Import:

- Να εμφανίζεται ξεκάθαρο CTA: **«Continue to Flash with this board»**.
- On click: κλείσιμο του import panel, άνοιγμα **Step 2** με το **board ήδη selected** στο dropdown (από το μόλις saved profile).
- Ο χρήστης βλέπει αμέσως συνέχεια: «έσωσα το board → τώρα το διάλεξα και συνεχίζω σε Device name & Network».

(Μπορεί να συνδυαστεί με Πρόταση 1: αν έχει «Use my YAML», το «Import Board from YAML» να δίνει αυτό το CTA ώστε και οι δύο δρόμοι να συγκλίνουν στο ίδιο Step 2.)

---

### Πρόταση 3: «Add peripheral» και πριν το πρώτο flash

- Στο **νέο «Use my YAML»** flow (Πρόταση 1), το Βήμα 2 να είναι «Add peripherals to this YAML» (draft).
- Backend: χρήση του ίδιου `addPeripheralToYaml` αλλά με:
  - input = το τρέχον YAML (από paste ή από previous step),
  - output = updated YAML που περνάει στο επόμενο step (device name + network + flash).
- Δεν απαιτείται `device_id` ούτε IP στο draft phase.

Έτσι «add peripherals» έχει δύο contexts:

| Context | Πότε | Τωρινό / Προτεινόμενο |
|--------|------|------------------------|
| **Πριν το 1ο flash** | Draft YAML (paste ή profile) | Νέο: «Add sensor» στο «Use my YAML» flow |
| **Μετά το flash (OTA)** | Ήδη flashed device | Υπάρχει: «Add to Device» |

---

### Πρόταση 4: Ονοματοδοσία & εμφάνιση

- Στην topbar (ή πάνω από τα steps) να υπάρχει ξεκάθαρα:
  - **«Board from catalog»** (τρέχον flow: Step 1 → 2 → 3 → 4 → 5).
  - **«Use my YAML»** (νέο flow: Paste → [Add peripherals] → Name & network → Flash).
- Στο Guide, tab «Flash a Peripheral Sensor» να αναφέρει και το «Use my YAML» σαν εναλλακτική (paste YAML → optional add sensors → flash).

---

## Β. Γενικές προτάσεις για το app

### UX / Οδηγίες

- **Onboarding:** Μετά το πρώτο login (ή πρώτο site), ένα σύντομο «Tour» ή tooltips: Dashboard → Installer (pending IOs) → Entities → Automation (map IOs).
- **ESPHome σελίδα:** Όταν ανοίγει πρώτη φορά, να εμφανίζεται αυτόματα το **Guide** (ή ένα σύντομο «Start here») αντί να είναι κρυμμένο πίσω από κουμπί.
- **Success feedback:** Μετά επιτυχημένο flash, ένα σαφές μήνυμα: «Πήγαινε στο Installer για να εγκρίνεις τα IOs» με link.

### Τεχνικά

- **API:** Ένα endpoint τύπου `POST /api/esphome/flash-from-yaml` (ή extend resolveConfig) για flash χωρίς προηγούμενο save στο catalog.
- **Validation:** Πριν το flash-from-yaml, να τρέχει ο validator πάνω στο merged YAML (όπως ήδη κάνετε με profile) ώστε να εμφανίζονται errors/warnings.
- **Catalog optional:** Το «Save Board Profile» μετά το parse να παραμένει **προαιρετικό** για όσους θέλουν να ξαναχρησιμοποιήσουν το ίδιο board· στο «Use my YAML» να μην είναι υποχρεωτικό.

### Performance / Scale

- **Events table:** Το cleanup (30 days) είναι καλό· αν τα events μεγαλώσουν πολύ, να σκεφτείτε index στο `(device_id, ts)` αν δεν υπάρχει ήδη.
- **MQTT reconnection:** Στο `mqtt.js` να υπάρχει automatic reconnect (συνήθως το client το κάνει)· να ελέγχετε ότι μετά το reconnect γίνονται subscribe ξανά αν χρειάζεται.

### Docs

- **ESPHome flow diagram:** Ένα απλό diagram (π.χ. Mermaid) στο repo: Paste/Import → Profile ή Draft → Device + Network → Flash → MQTT → Pending IOs → Approve → Automation. Βοηθά νέους developers και power users.

---

## Γ. Σύνοψη προτεραιότητας

| Προτεραιότητα | Πρόταση | Ε-effort |
|---------------|---------|-----------|
| 1 | «Use my YAML» flow: Paste → (Add peripherals) → Name & network → Flash | Μέσο |
| 2 | Μετά Import YAML: CTA «Continue to Flash» + auto-select board στο Step 2 | Μικρό |
| 3 | Add peripheral στο draft YAML (πριν 1ο flash) | Μέσο (αν γίνει με Πρόταση 1) |
| 4 | Ονοματοδοσία: «Board from catalog» vs «Use my YAML» στην UI | Μικρό |
| 5 | Guide / onboarding improvements | Μικρό |
| 6 | `flash-from-yaml` API + validation | Μέσο |

Αν θες, μπορούμε στο επόμενο βήμα να σπάσουμε την Πρόταση 1 σε συγκεκριμένα tasks (frontend + backend) για implementation.
