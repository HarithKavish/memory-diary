import 'package:flutter/material.dart';
import 'api_client.dart';
import 'home_screen.dart';

class LoginScreen extends StatefulWidget {
  final ApiClient api;
  const LoginScreen({super.key, required this.api});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _controller = TextEditingController();
  bool _loading = false;
  String? _error;

  Future<void> _submit() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await widget.api.login(_controller.text);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => HomeScreen(api: widget.api)),
      );
    } on ApiException catch (e) {
      // Only a real 401 from the server means the passphrase itself was wrong - any
      // other status (e.g. a 500 from a Mongo/JWT-signing outage) is a server
      // problem, not something the user can fix by re-typing the passphrase.
      setState(() {
        _error = e.statusCode == 401
            ? 'Could not log in — check the passphrase.'
            : 'Server error while logging in ($e). Not a passphrase problem - try again shortly.';
      });
    } catch (e) {
      // Anything that isn't an ApiException never got a response at all (can't
      // resolve host, connection refused, timeout, ...) - almost never actually the
      // passphrase, usually a misconfigured API_BASE_URL. Show the URL this
      // specific ApiClient instance is actually using (not main.dart's compile-time
      // constant, which can differ - e.g. in tests).
      setState(() => _error = "Couldn't reach the server at ${widget.api.baseUrl} — $e");
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.psychology_alt_outlined, size: 56),
                const SizedBox(height: 16),
                Text('memory-diary', style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 24),
                TextField(
                  controller: _controller,
                  obscureText: true,
                  autofocus: true,
                  decoration: const InputDecoration(
                    labelText: 'Passphrase',
                    border: OutlineInputBorder(),
                  ),
                  onSubmitted: (_) => _submit(),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ],
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _loading ? null : _submit,
                  child: _loading
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Unlock'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
