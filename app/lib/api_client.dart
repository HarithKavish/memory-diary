import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class Entry {
  final String id;
  final String topic;
  final String summary;
  final List<String> tags;
  final String domain;

  Entry({
    required this.id,
    required this.topic,
    required this.summary,
    required this.tags,
    required this.domain,
  });

  factory Entry.fromJson(Map<String, dynamic> json) => Entry(
        id: json['_id'] as String,
        topic: json['topic'] as String? ?? '',
        summary: json['summary'] as String? ?? '',
        tags: (json['tags'] as List?)?.map((e) => e.toString()).toList() ?? const [],
        domain: json['domain'] as String? ?? '',
      );
}

class ApiException implements Exception {
  final String message;
  ApiException(this.message);
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
      throw ApiException('login failed (${res.statusCode})');
    }
    final token = jsonDecode(res.body)['token'] as String;
    await _storage.write(key: _tokenKey, value: token);
  }

  Future<bool> hasSession() async => (await _storage.read(key: _tokenKey)) != null;

  Future<void> logout() async => _storage.delete(key: _tokenKey);

  Future<Map<String, String>> _authHeaders() async {
    final token = await _storage.read(key: _tokenKey);
    if (token == null) throw ApiException('not logged in');
    return {'content-type': 'application/json', 'authorization': 'Bearer $token'};
  }

  Future<List<Entry>> listEntries({String? query}) async {
    final uri = Uri.parse('$baseUrl/entries').replace(
      queryParameters: query != null && query.isNotEmpty ? {'q': query} : null,
    );
    final res = await http.get(uri, headers: await _authHeaders());
    if (res.statusCode == 401) throw ApiException('session expired');
    if (res.statusCode != 200) throw ApiException('failed to load entries (${res.statusCode})');
    final list = jsonDecode(res.body)['entries'] as List;
    return list.map((e) => Entry.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Sends free text. The backend decides whether this is a new fact, a correction to
  /// an existing one, or a deletion, and returns what it did.
  Future<Map<String, dynamic>> tellIt(String text) async {
    final res = await http.post(
      Uri.parse('$baseUrl/entries'),
      headers: await _authHeaders(),
      body: jsonEncode({'text': text}),
    );
    if (res.statusCode == 401) throw ApiException('session expired');
    if (res.statusCode >= 400) throw ApiException('failed (${res.statusCode}): ${res.body}');
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<void> updateEntry(String id, Entry fact) async {
    final res = await http.patch(
      Uri.parse('$baseUrl/entries/$id'),
      headers: await _authHeaders(),
      body: jsonEncode({
        'topic': fact.topic,
        'summary': fact.summary,
        'tags': fact.tags,
        'domain': fact.domain,
      }),
    );
    if (res.statusCode != 200) throw ApiException('update failed (${res.statusCode})');
  }

  Future<void> deleteEntry(String id) async {
    final res = await http.delete(Uri.parse('$baseUrl/entries/$id'), headers: await _authHeaders());
    if (res.statusCode != 200) throw ApiException('delete failed (${res.statusCode})');
  }
}
