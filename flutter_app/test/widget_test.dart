// Boot and layout tests for the scaffold itself, so `flutter test` is green
// before you start.
//
// These guard the baseline's own chrome. They are not part of the assignment —
// what you'd test in the flow you build is your call.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:credit_line/main.dart';
import 'package:credit_line/tokens.dart';

void main() {
  testWidgets('app boots to the baseline home', (tester) async {
    await tester.pumpWidget(const TakeHomeApp());
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byType(MaterialApp), findsOneWidget);
    expect(find.text('Your credit line'), findsOneWidget);
  });

  testWidgets('persona row: label sits left, control sits right, both centred',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(const TakeHomeApp());
    await tester.pump(const Duration(milliseconds: 300));

    final label = tester.getRect(find.text('PERSONA'));
    final value = tester.getRect(find.text('approved').last);
    final chevron = tester.getRect(find.byIcon(Icons.expand_more));

    // Both flush to the screen padding.
    expect(label.left, moreOrLessEquals(T.s5, epsilon: 0.5),
        reason: 'label should start at the content edge');
    expect(chevron.right, moreOrLessEquals(390 - T.s5, epsilon: 1.5),
        reason: 'chevron should finish at the content edge');

    // The value hugs its chevron rather than floating away from it, which is
    // what happens if the button is left to size itself to the longest persona.
    expect(chevron.left - value.right, lessThan(T.s4),
        reason: 'value should sit next to the chevron');

    // Shared vertical axis.
    expect(label.center.dy, moreOrLessEquals(value.center.dy, epsilon: 1.5));
    expect(value.center.dy, moreOrLessEquals(chevron.center.dy, epsilon: 1.5));
  });
}
