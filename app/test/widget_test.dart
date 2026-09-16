import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:memory_diary/api_client.dart';
import 'package:memory_diary/login_screen.dart';

void main() {
  // Pumps LoginScreen directly rather than the app's FutureBuilder root, which calls
  // into flutter_secure_storage's platform channel on startup - unavailable in a plain
  // `flutter test` run (no device/platform bindings) and not what this test is about.
  testWidgets('login screen shows the passphrase field', (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: LoginScreen(api: ApiClient('https://example.invalid'))),
    );

    expect(find.text('memory-diary'), findsOneWidget);
    expect(find.text('Passphrase'), findsOneWidget);
  });
}
