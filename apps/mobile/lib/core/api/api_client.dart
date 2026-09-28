import 'dart:convert';

import 'package:http/http.dart' as http;

class ApiClient {
  ApiClient({
    http.Client? client,
  }) : _client = client ?? http.Client();

  final http.Client _client;

  /// URL du backend P-Elsa.
  ///
  /// La valeur peut être fournie au lancement avec :
  ///
  /// Windows :
  /// --dart-define=API_BASE_URL=http://localhost:3000
  ///
  /// Android Emulator :
  /// --dart-define=API_BASE_URL=http://10.0.2.2:3000
  ///
  /// Android physique :
  /// --dart-define=API_BASE_URL=http://10.233.224.1:3000
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000',
  );

  Future<Map<String, dynamic>> get(
      String path, {
        String? token,
      }) async {
    final response = await _client.get(
      _buildUri(path),
      headers: _headers(token),
    );

    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> post(
      String path, {
        Map<String, dynamic>? body,
        String? token,
      }) async {
    final response = await _client.post(
      _buildUri(path),
      headers: _headers(token),
      body: jsonEncode(body ?? <String, dynamic>{}),
    );

    return _handleResponse(response);
  }

  Uri _buildUri(String path) {
    final normalizedPath =
    path.startsWith('/') ? path : '/$path';

    return Uri.parse('$baseUrl$normalizedPath');
  }

  Map<String, String> _headers(String? token) {
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    return headers;
  }

  Map<String, dynamic> _handleResponse(
      http.Response response,
      ) {
    final decoded = _decodeBody(response.body);

    if (response.statusCode >= 200 &&
        response.statusCode < 300) {
      return decoded;
    }

    final message = decoded['message'];

    if (message is String && message.isNotEmpty) {
      throw ApiException(
        statusCode: response.statusCode,
        message: message,
      );
    }

    throw ApiException(
      statusCode: response.statusCode,
      message: 'Erreur HTTP ${response.statusCode}.',
    );
  }

  Map<String, dynamic> _decodeBody(String body) {
    if (body.trim().isEmpty) {
      return <String, dynamic>{};
    }

    try {
      final decoded = jsonDecode(body);

      if (decoded is Map<String, dynamic>) {
        return decoded;
      }

      return <String, dynamic>{
        'data': decoded,
      };
    } catch (_) {
      return <String, dynamic>{
        'message': body,
      };
    }
  }

  void dispose() {
    _client.close();
  }
}

class ApiException implements Exception {
  const ApiException({
    required this.statusCode,
    required this.message,
  });

  final int statusCode;
  final String message;

  @override
  String toString() {
    return 'ApiException($statusCode): $message';
  }
}