import 'dart:convert';

import 'package:flutter/foundation.dart'
    show kIsWeb, defaultTargetPlatform, TargetPlatform;
import 'package:http/http.dart' as http;

/// One HTTP response, decoded. Status code is kept so you can tell a 201 from a
/// 202 from a 409 — several of them mean different things here.
class ApiResult {
  ApiResult(this.statusCode, this.body, this.headers);

  final int statusCode;
  final Map<String, dynamic> body;
  final Map<String, String> headers;

  bool get isSuccess => statusCode >= 200 && statusCode < 300;

  /// The API's machine-readable error code, when there is one.
  String? get errorCode => body['error'] as String?;

  @override
  String toString() => 'ApiResult($statusCode, $body)';
}

/// Thin client for the mock API in `../mock-api`. Start that first.
///
/// This exists so you don't spend your box on plumbing. It deliberately does
/// not model the domain — no request/decision classes, no state management.
/// That's yours.
class ApiClient {
  ApiClient({http.Client? client, this.persona = 'approved'})
      : _client = client ?? http.Client();

  final http.Client _client;

  /// Which member the server should pretend you're logged in as.
  /// See `mock-api/README.md` for the list.
  String persona;

  static String get _host {
    if (kIsWeb) return 'localhost';
    // The Android emulator can't see the host machine's localhost.
    return defaultTargetPlatform == TargetPlatform.android ? '10.0.2.2' : 'localhost';
  }

  static const _port = 4010;
  Uri _uri(String path) => Uri.parse('http://$_host:$_port$path');

  Map<String, String> _headers() => {
        'content-type': 'application/json',
        'x-test-persona': persona,
      };

  Future<ApiResult> _wrap(Future<http.Response> f) async {
    final r = await f;
    Map<String, dynamic> body;
    try {
      body = r.body.isEmpty ? {} : jsonDecode(r.body) as Map<String, dynamic>;
    } catch (_) {
      body = {'error': 'UNPARSEABLE', 'raw': r.body};
    }
    return ApiResult(r.statusCode, body, r.headers);
  }

  /// Limit, maximum eligible limit, balance, pending holds, member.
  Future<ApiResult> getCreditLine() =>
      _wrap(_client.get(_uri('/v1/credit-line'), headers: _headers()));

  /// Submit a request. A member can request once; after that the server
  /// answers 409 and `increase_request` on the credit line carries the
  /// decision.
  Future<ApiResult> submitIncreaseRequest({required int amountCents}) =>
      _wrap(_client.post(
        _uri('/v1/credit-line/increase-requests'),
        headers: _headers(),
        body: jsonEncode({'requested_amount_cents': amountCents}),
      ));

  void dispose() => _client.close();
}
