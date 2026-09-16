import 'package:flutter/material.dart';
import 'api_client.dart';
import 'login_screen.dart';
import 'home_screen.dart';

/// Only the Worker's public base URL is compiled into the app — never a secret.
/// Override at build time: --dart-define=API_BASE_URL=https://your-worker.workers.dev
const String apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'https://memory-diary-worker.example.workers.dev',
);

void main() {
  runApp(MemoryDiaryApp(api: ApiClient(apiBaseUrl)));
}

class MemoryDiaryApp extends StatelessWidget {
  final ApiClient api;
  const MemoryDiaryApp({super.key, required this.api});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'memory-diary',
      theme: ThemeData(colorSchemeSeed: Colors.teal, useMaterial3: true),
      darkTheme: ThemeData(
        colorSchemeSeed: Colors.teal,
        brightness: Brightness.dark,
        useMaterial3: true,
      ),
      home: FutureBuilder<bool>(
        future: api.hasSession(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return const Scaffold(body: Center(child: CircularProgressIndicator()));
          }
          return snapshot.data! ? HomeScreen(api: api) : LoginScreen(api: api);
        },
      ),
    );
  }
}
