# flutter_app

Boots to a blank screen with a connection test. Start the mock API first:

```bash
cd ../mock-api && npm start
```

Then:

```bash
flutter pub get
flutter run
```

`lib/api_client.dart` handles the HTTP so you don't have to. `lib/tokens.dart` has
colours, spacing and type. Use them and don't spend time on visual design.

Android emulator note: the client already points at `10.0.2.2` on Android, since the
emulator can't see the host's `localhost`. iOS simulator, macOS and web use `localhost`.
