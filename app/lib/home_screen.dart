import 'package:flutter/material.dart';
import 'api_client.dart';
import 'login_screen.dart';

class HomeScreen extends StatefulWidget {
  final ApiClient api;
  const HomeScreen({super.key, required this.api});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _tellController = TextEditingController();
  final _searchController = TextEditingController();
  List<Entry> _entries = [];
  bool _loadingEntries = true;
  bool _sending = false;
  String? _lastActionMessage;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh({String? query}) async {
    setState(() => _loadingEntries = true);
    try {
      final entries = await widget.api.listEntries(query: query);
      if (!mounted) return;
      setState(() => _entries = entries);
    } on ApiException catch (e) {
      if (e.toString().contains('session expired') && mounted) {
        await widget.api.logout();
        if (!mounted) return;
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => LoginScreen(api: widget.api)),
        );
        return;
      }
      _showError(e.toString());
    } finally {
      if (mounted) setState(() => _loadingEntries = false);
    }
  }

  Future<void> _tellIt() async {
    final text = _tellController.text.trim();
    if (text.isEmpty) return;
    setState(() {
      _sending = true;
      _lastActionMessage = null;
    });
    try {
      final result = await widget.api.tellIt(text);
      _tellController.clear();
      setState(() => _lastActionMessage = _describeResult(result));
      await _refresh();
    } on ApiException catch (e) {
      _showError(e.toString());
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  String _describeResult(Map<String, dynamic> result) {
    switch (result['action']) {
      case 'create':
        return 'Saved as new: ${result['fact']?['topic'] ?? ''}';
      case 'update':
        return 'Corrected: ${result['fact']?['topic'] ?? ''}';
      case 'delete':
        return 'Removed that fact.';
      case 'noop':
        return result['reason'] as String? ?? "Didn't look like a fact to store.";
      default:
        return 'Done.';
    }
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _confirmDelete(Entry entry) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete this fact?'),
        content: Text(entry.summary),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete')),
        ],
      ),
    );
    if (confirmed == true) {
      await widget.api.deleteEntry(entry.id);
      await _refresh();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('memory-diary'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () async {
              await widget.api.logout();
              if (!context.mounted) return;
              Navigator.of(context).pushReplacement(
                MaterialPageRoute(builder: (_) => LoginScreen(api: widget.api)),
              );
            },
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                TextField(
                  controller: _tellController,
                  minLines: 1,
                  maxLines: 4,
                  decoration: InputDecoration(
                    labelText: 'Tell it something (new fact, or a correction)',
                    border: const OutlineInputBorder(),
                    suffixIcon: IconButton(
                      icon: _sending
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.send),
                      onPressed: _sending ? null : _tellIt,
                    ),
                  ),
                  onSubmitted: (_) => _tellIt(),
                ),
                if (_lastActionMessage != null) ...[
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      _lastActionMessage!,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                TextField(
                  controller: _searchController,
                  decoration: const InputDecoration(
                    labelText: 'Search your facts',
                    prefixIcon: Icon(Icons.search),
                    border: OutlineInputBorder(),
                  ),
                  onSubmitted: (q) => _refresh(query: q),
                ),
              ],
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () => _refresh(query: _searchController.text),
              child: _loadingEntries
                  ? const Center(child: CircularProgressIndicator())
                  : _entries.isEmpty
                      ? ListView(
                          children: const [
                            Padding(
                              padding: EdgeInsets.all(32),
                              child: Center(child: Text('Nothing stored yet.')),
                            ),
                          ],
                        )
                      : ListView.builder(
                          itemCount: _entries.length,
                          itemBuilder: (context, i) {
                            final entry = _entries[i];
                            return ListTile(
                              title: Text(entry.topic),
                              subtitle: Text(entry.summary),
                              trailing: IconButton(
                                icon: const Icon(Icons.delete_outline),
                                onPressed: () => _confirmDelete(entry),
                              ),
                            );
                          },
                        ),
            ),
          ),
        ],
      ),
    );
  }
}
