import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'api_client.dart';
import 'tokens.dart';

// The baseline flow: Home -> Request -> Result. It works end to end against
// the mock API, and it is deliberately the least it could be. Improving it is
// the exercise — read README.md, then mock-api/README.md.

void main() => runApp(const TakeHomeApp());

String money(int cents) => '\$${NumberFormat('#,##0.00').format(cents / 100)}';
String moneyWhole(int cents) => '\$${NumberFormat('#,##0').format(cents / 100)}';

class TakeHomeApp extends StatelessWidget {
  const TakeHomeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Credit line',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        scaffoldBackgroundColor: T.paper,
        colorScheme: ColorScheme.fromSeed(seedColor: T.accent, primary: T.accent),
      ),
      home: const HomePage(),
    );
  }
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final api = ApiClient();

  Map<String, dynamic>? _account;
  String? _error;
  bool _loading = true;

  static const _personas = [
    'approved',
    'utilization-too-high',
    'insufficient-history',
    'new-credit-lines',
  ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final r = await api.getCreditLine();
      if (!mounted) return;
      setState(() {
        if (r.isSuccess) {
          _account = r.body;
        } else {
          _error = 'The API answered HTTP ${r.statusCode}.';
        }
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not reach the mock API.\nIs it running? cd mock-api && npm start';
        _loading = false;
      });
    }
  }

  @override
  void dispose() {
    api.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final limit = _account?['limit_cents'] as int?;
    final spent = _account?['balance_cents'] as int?;

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(T.s5),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Your credit line', style: T.title),
              const SizedBox(height: T.s5),
              if (_loading)
                const Expanded(child: Center(child: CircularProgressIndicator()))
              else if (_error != null)
                Expanded(
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error!, style: T.bodyMuted, textAlign: TextAlign.center),
                        const SizedBox(height: T.s4),
                        OutlinedButton(onPressed: _load, child: const Text('Retry')),
                      ],
                    ),
                  ),
                )
              else ...[
                // A member who has already requested doesn't get the button.
                if (_account?['increase_request'] == null)
                  FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: T.accent,
                      foregroundColor: T.accentInk,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(T.radius)),
                      padding: const EdgeInsets.symmetric(vertical: T.s3 + 2),
                    ),
                    onPressed: () async {
                      await Navigator.of(context).push(MaterialPageRoute(
                        builder: (_) => RequestPage(api: api, limitCents: limit ?? 0),
                      ));
                      _load();
                    },
                    child: const Text('Increase'),
                  ),
                const SizedBox(height: T.s4),
                Container(
                  padding: const EdgeInsets.all(T.s4),
                  decoration: BoxDecoration(
                    color: T.surface,
                    border: Border.all(color: T.rule),
                    borderRadius: BorderRadius.circular(T.radius),
                  ),
                  child: Column(
                    children: [
                      _row('Credit limit', money(limit ?? 0)),
                      const Divider(color: T.rule, height: T.s4),
                      _row('Spent', money(spent ?? 0)),
                    ],
                  ),
                ),
                const Spacer(),
              ],
              // Scaffold control, not product: flips the account state the
              // server pretends you're logged in as. Not graded either way.
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  const Text('PERSONA', style: T.label),
                  const SizedBox(width: T.s3),
                  // Flexible + isExpanded so the control takes the remaining
                  // width and the selected value right-aligns against its
                  // chevron instead of sizing to the longest persona name.
                  Flexible(
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<String>(
                        value: api.persona,
                        isDense: true,
                        isExpanded: true,
                        alignment: AlignmentDirectional.centerEnd,
                        borderRadius: BorderRadius.circular(T.radius),
                        style: T.small,
                        icon: const Padding(
                          padding: EdgeInsets.only(left: T.s1),
                          child: Icon(Icons.expand_more, size: 18, color: T.ink2),
                        ),
                        items: [
                          for (final p in _personas)
                            DropdownMenuItem(
                              value: p,
                              alignment: AlignmentDirectional.centerEnd,
                              child: Text(p, style: T.small),
                            ),
                        ],
                        onChanged: (v) {
                          if (v == null) return;
                          setState(() => api.persona = v);
                          _load();
                        },
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _row(String k, String v) => Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [Text(k, style: T.bodyMuted), Text(v, style: T.numeric)],
      );
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

class RequestPage extends StatefulWidget {
  const RequestPage({super.key, required this.api, required this.limitCents});

  final ApiClient api;
  final int limitCents;

  @override
  State<RequestPage> createState() => _RequestPageState();
}

class _RequestPageState extends State<RequestPage> {
  double _amountDollars = 500;
  bool _submitting = false;

  Future<void> _submit() async {
    setState(() => _submitting = true);
    ApiResult? result;
    String? error;
    try {
      result = await widget.api
          .submitIncreaseRequest(amountCents: (_amountDollars * 100).round());
    } catch (e) {
      error = 'Could not reach the mock API.';
    }
    if (!mounted) return;
    setState(() => _submitting = false);
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => ResultPage(result: result, error: error),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final increase = (_amountDollars * 100).round();
    return Scaffold(
      appBar: AppBar(backgroundColor: T.paper, elevation: 0, foregroundColor: T.ink),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(T.s5, 0, T.s5, T.s5),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Request an increase', style: T.title),
              const SizedBox(height: T.s5),
              Container(
                padding: const EdgeInsets.all(T.s4),
                decoration: BoxDecoration(
                  color: T.surface,
                  border: Border.all(color: T.rule),
                  borderRadius: BorderRadius.circular(T.radius),
                ),
                child: Column(
                  children: [
                    const Text('INCREASE BY', style: T.label),
                    const SizedBox(height: T.s1),
                    Text(moneyWhole(increase), style: T.display),
                    Slider(
                      value: _amountDollars,
                      min: 100,
                      max: 2500,
                      divisions: 48,
                      activeColor: T.accent,
                      onChanged: (v) => setState(() => _amountDollars = v),
                    ),
                    Text(
                      'New limit if approved: ${money(widget.limitCents + increase)}',
                      style: T.small,
                    ),
                  ],
                ),
              ),
              const Spacer(),
              FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: T.accent,
                  foregroundColor: T.accentInk,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(T.radius)),
                  padding: const EdgeInsets.symmetric(vertical: T.s3 + 2),
                ),
                onPressed: _submitting ? null : _submit,
                child: Text(_submitting ? 'Submitting…' : 'Submit'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

class ResultPage extends StatelessWidget {
  const ResultPage({super.key, this.result, this.error});

  final ApiResult? result;
  final String? error;

  (String, String) _copy() {
    if (error != null || result == null) {
      return ('Something went wrong', 'Please try again later.');
    }
    final r = result!;
    final status = r.body['status'] as String?;
    if (r.statusCode >= 500) {
      return ('Something went wrong', 'Please try again later.');
    }
    if (status == 'APPROVED') {
      final newLimit = r.body['new_limit_cents'] as int?;
      return ('Approved',
          newLimit != null ? 'Your new limit is ${money(newLimit)}.' : 'Your limit went up.');
    }
    if (status == 'DECLINED') {
      return ('Declined', "We can't increase your limit right now.");
    }
    final message = r.body['message'] as String?;
    return ('Request not sent', message ?? 'The API answered HTTP ${r.statusCode}.');
  }

  @override
  Widget build(BuildContext context) {
    final (headline, detail) = _copy();
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(T.s5),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: T.s7),
              Text(headline, style: T.title),
              const SizedBox(height: T.s2),
              Text(detail, style: T.bodyMuted),
              const Spacer(),
              FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: T.accent,
                  foregroundColor: T.accentInk,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(T.radius)),
                  padding: const EdgeInsets.symmetric(vertical: T.s3 + 2),
                ),
                onPressed: () =>
                    Navigator.of(context).popUntil((route) => route.isFirst),
                child: const Text('Back to Home'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
