import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'api_client.dart';
import 'login_screen.dart';

class HomeScreen extends StatefulWidget {
  final ApiClient api;
  const HomeScreen({super.key, required this.api});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _controller = TextEditingController();
  final _picker = ImagePicker();
  final List<CommandResult> _log = [];
  bool _sending = false;

  Future<void> _handleSessionExpiry(ApiException e) async {
    if (e.statusCode != 401) return;
    await widget.api.logout();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => LoginScreen(api: widget.api)));
  }

  Future<void> _submit() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final result = await widget.api.tellIt(text);
      _controller.clear();
      setState(() => _log.insert(0, result));
    } on ApiException catch (e) {
      if (e.statusCode == 401) {
        await _handleSessionExpiry(e);
        return;
      }
      _showError(e.toString());
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _pickAndUploadImage() async {
    final picked = await _picker.pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (picked == null) return;
    setState(() => _sending = true);
    try {
      final result = await widget.api.uploadImage(File(picked.path));
      setState(() => _log.insert(0, result));
    } on ApiException catch (e) {
      if (e.statusCode == 401) {
        await _handleSessionExpiry(e);
        return;
      }
      _showError(e.toString());
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
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
              Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => LoginScreen(api: widget.api)));
            },
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: _log.isEmpty
                ? const _EmptyLogHint()
                : ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _log.length,
                    separatorBuilder: (context, index) => const SizedBox(height: 12),
                    itemBuilder: (context, i) => _ResultCard(result: _log[i], api: widget.api),
                  ),
          ),
          const Divider(height: 1),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      expands: true,
                      maxLines: null,
                      minLines: null,
                      textAlignVertical: TextAlignVertical.top,
                      decoration: const InputDecoration(
                        hintText: 'Tell it something, ask it something, or ask it to change or remove something',
                        border: OutlineInputBorder(),
                        alignLabelWithHint: true,
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      IconButton(
                        icon: const Icon(Icons.image_outlined),
                        tooltip: 'Add an image',
                        onPressed: _sending ? null : _pickAndUploadImage,
                      ),
                      const Spacer(),
                      FilledButton.icon(
                        onPressed: _sending ? null : _submit,
                        icon: _sending
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.send),
                        label: const Text('Send'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyLogHint extends StatelessWidget {
  const _EmptyLogHint();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Text(
          'Tell it a fact, ask it what it knows, or ask it to change or remove something.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Theme.of(context).hintColor),
        ),
      ),
    );
  }
}

class _ActionBadge {
  final IconData icon;
  final String label;
  const _ActionBadge(this.icon, this.label);
}

const _actionBadges = {
  'create': _ActionBadge(Icons.add_circle_outline, 'Created'),
  'update': _ActionBadge(Icons.edit_outlined, 'Updated'),
  'delete': _ActionBadge(Icons.delete_outline, 'Deleted'),
  'retrieve': _ActionBadge(Icons.check_circle_outline, 'Retrieved'),
  'noop': _ActionBadge(Icons.info_outline, 'No action'),
};

class _ResultCard extends StatelessWidget {
  final CommandResult result;
  final ApiClient api;
  const _ResultCard({required this.result, required this.api});

  @override
  Widget build(BuildContext context) {
    final badge = _actionBadges[result.action] ?? _actionBadges['noop']!;
    final entries = result.entries.isNotEmpty ? result.entries : (result.fact != null ? [result.fact!] : const <Entry>[]);

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(badge.icon, size: 18),
                const SizedBox(width: 6),
                Text(badge.label, style: Theme.of(context).textTheme.labelLarge),
              ],
            ),
            if (entries.isEmpty) ...[
              const SizedBox(height: 8),
              Text(
                result.reason ?? (result.action == 'retrieve' ? 'Nothing found.' : ''),
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ] else
              for (final entry in entries) ...[
                const SizedBox(height: 8),
                _EntryFields(entry: entry, api: api),
              ],
          ],
        ),
      ),
    );
  }
}

/// Renders one entry as plain key/value rows - deliberately not a sentence, per the
/// point of this screen: you asked a question or gave a command, this shows exactly
/// what is stored, not a paraphrase of it.
class _EntryFields extends StatelessWidget {
  final Entry entry;
  final ApiClient api;
  const _EntryFields({required this.entry, required this.api});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (entry.imageKey != null) ...[
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: FutureBuilder<Map<String, String>>(
              future: api.imageHeaders(),
              builder: (context, snapshot) {
                if (!snapshot.hasData) return const SizedBox(height: 120);
                return Image.network(
                  api.imageUrl(entry.imageKey!),
                  headers: snapshot.data,
                  height: 160,
                  fit: BoxFit.cover,
                  errorBuilder: (context, error, stackTrace) => const SizedBox(
                    height: 80,
                    child: Center(child: Icon(Icons.broken_image_outlined)),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 8),
        ],
        _KeyValueRow('Topic', entry.topic),
        _KeyValueRow('Summary', entry.summary),
        _KeyValueRow('Domain', entry.domain),
        if (entry.tags.isNotEmpty) _KeyValueRow('Tags', entry.tags.join(', ')),
      ],
    );
  }
}

class _KeyValueRow extends StatelessWidget {
  final String label;
  final String value;
  const _KeyValueRow(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    if (value.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: RichText(
        text: TextSpan(
          style: DefaultTextStyle.of(context).style,
          children: [
            TextSpan(text: '$label: ', style: const TextStyle(fontWeight: FontWeight.w600)),
            TextSpan(text: value),
          ],
        ),
      ),
    );
  }
}
