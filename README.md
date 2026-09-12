# Mariellas Wunschliste

Statische Seite auf GitHub Pages, Daten in Supabase.

* **Lesen** darf jede:r mit dem Link.
* **Reservieren** ebenfalls – anonym, aber mit einem selbst gewählten Passwort.
  Nur wer dieses Passwort kennt, kann die Reservierung wieder aufheben. Das
  Passwort liegt als bcrypt-Hash in `wish_locks` und ist über die API nicht
  lesbar. Der Admin kann eine Reservierung notfalls ohne dieses Passwort
  freigeben, damit ein vergessenes Passwort keinen Wunsch dauerhaft blockiert.
* **Hinzufügen, bearbeiten, löschen** nur im Admin-Modus: unten auf der Seite
  über „Verwalten" mit Passwort anmelden. Gäste sehen davon nichts.
  Das Passwort wird serverseitig in Postgres geprüft (bcrypt), steht also
  nirgends im Quellcode. Die Anmeldung bleibt im Browser gespeichert,
  bis man auf „Abmelden" klickt.

## Einrichtung

1. Projekt auf [supabase.com](https://supabase.com) anlegen (kostenlos).
2. Im **SQL Editor** den Inhalt von `supabase/schema.sql` ausführen.
   Vorher `HIER-DEIN-PASSWORT` durch das gewünschte Passwort ersetzen.
   Danach `supabase/migration-02.sql` ausführen.
3. Unter **Project Settings → API** `Project URL` und `anon public` key kopieren
   und in `js/config.js` eintragen.
4. Committen, pushen – GitHub Pages baut automatisch neu.

Beide Werte in `config.js` sind absichtlich öffentlich. Der anon key kann nur
das, was die Row-Level-Security-Regeln erlauben: Wünsche lesen und reservieren.

## Passwort ändern

Im SQL Editor:

```sql
update public.app_secret
set password_hash = extensions.crypt('NEUES-PASSWORT', extensions.gen_salt('bf'))
where id = 1;
```

## Struktur

```
index.html          Seite
css/style.css       Styles
js/config.js        Supabase-Zugangsdaten
js/app.js           Logik
supabase/schema.sql       Tabellen, Policies, Funktionen (Erstaufsetzung)
supabase/migration-02.sql Bemerkungsfeld + Reservierungspasswörter
```

## Lokal testen

```powershell
python -m http.server 8000
```

Dann http://localhost:8000 öffnen.
