import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class Entry {
  final String id;
  final String topic;
  final String summary;
  final List<String> tags;
  final String domain;
  final String? imageKey;

  Entry({
    required this.id,
    required this.topic,
    required this.summary,
    required this.tags,
    required this.domain,
    this.imageKey,
  });

  factory Entry.fromJson(Map<String, dynamic> json) => Entry(
        id: json['_id'] as String,
        topic: json['topic'] as String? ?? '',
        summary: json['summary'] as String? ?? '',
        tags: (json['tags'] as List?)?.map((e) => e.toString()).toList() ?? const [],
        domain: json['domain'] as String? ?? '',
        imageKey: json['imageKey'] as String?,
      );
}

/// One outcome of a submitted command - what the backend actually did, in a shape the
/// UI renders as a labeled, structured result rather than a sentence.
class CommandResult {
  final String action; // create | update | delete | retrieve | noop
  final String? reason;
  final Entry? fact; // create/update/delete: the single affected entry
  final List<Entry> entries; // retrieve: zero or more matches

  CommandResult({required this.action, this.reason, this.fact, this.entries = const []});

  factory CommandResult.fromJson(Map<String, dynamic> json) => CommandResult(
        action: json['action'] as String,
        reason: json['reason'] as String?,
        fact: json['fact'] != null ? Entry.fromJson({...json['fact'] as Map, '_id': json['id'] ?? ''}) : null,
        entries: (json['entries'] as List?)
                ?.map((e) => Entry.fromJson(e as Map<String, dynamic>))
                .toList() ??
            const [],
      );
}

class ApiException implements Exception {
  final String message;
  /// The HTTP status code that caused this, when it came from a real server
  /// response - null for anything that never got that far (e.g. "not logged in").
  final int? statusCode;
  ApiException(this.message, {this.statusCode});
  @override
  String toString() => message;
}

/// Talks to the memory-diary Worker. Holds no secret of its own — only the session JWT
/// issued after a successful passphrase login, kept in secure storage.
class ApiClient {
  static const _storage = FlutterSecureStorage();
  static const _tokenKey = 'session_token';

  final String baseUrl;
  ApiClient(this.baseUrl);

  Future<void> login(String passphrase) async {
    final res = await http.post(
      Uri.parse('$baseUrl/auth/login'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({'passphrase': passphrase}),
    );
    if (res.statusCode != 200) {
      throw ApiException('login failed (${res.statusCode})', statusCode: res.statusCode);
    }
    final token = jsonDecode(res.body)['token'] as String;
    await _storage.write(key: _tokenKey, value: token);
  }

  Future<bool> hasSession() async => (await _storage.read(key: _tokenKey)) != null;

  Future<void> logout() async => _storage.delete(key: _tokenKey);

  Future<String> _requireToken() async {
    final token = await _storage.read(key: _tokenKey);
    if (token == null) throw ApiException('not logged in');
    return token;
  }

  Future<Map<String, String>> _authHeaders() async {
    final token = await _requireToken();
    return {'content-type': 'application/json', 'authorization': 'Bearer $token'};
  }

  /// Headers for loading an image via Image.network - same bearer token, no JSON
  /// content-type since there's no body.
  Future<Map<String, String>> imageHeaders() async {
    final token = await _requireToken();
    return {'authorization': 'Bearer $token'};
  }

  String imageUrl(String imageKey) => '$baseUrl/images/$imageKey';

  /// Sends free text. The backend decides whether this is a new fact, a correction, a
  /// deletion, or a retrieval - the response says which, structured, not prose.
  Future<CommandResult> tellIt(String text) async {
    final res = await http.post(
      Uri.parse('$baseUrl/entries'),
      headers: await _authHeaders(),
      body: jsonEncode({'text': text}),
    );
    if (res.statusCode == 401) throw ApiException('session expired', statusCode: 401);
    if (res.statusCode >= 400) {
      throw ApiException('failed (${res.statusCode}): ${res.body}', statusCode: res.statusCode);
    }
    return CommandResult.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
  }

  /// Uploads an image: the backend captions it, structures the caption like any other
  /// fact, and stores both - always a "create" result.
  Future<CommandResult> uploadImage(File imageFile) async {
    final token = await _requireToken();
    final request = http.MultipartRequest('POST', Uri.parse('$baseUrl/images'))
      ..headers['authorization'] = 'Bearer $token'
      ..files.add(await http.MultipartFile.fromPath('image', imageFile.path));
    final streamed = await request.send();
    final res = await http.Response.fromStream(streamed);
    if (res.statusCode == 401) throw ApiException('session expired', statusCode: 401);
    if (res.statusCode >= 400) {
      throw ApiException('upload failed (${res.statusCode}): ${res.body}', statusCode: res.statusCode);
    }
    return CommandResult.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
  }
}
