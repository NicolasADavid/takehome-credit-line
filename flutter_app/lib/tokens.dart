import 'package:flutter/material.dart';

/// Design tokens for the take-home.
///
/// Deliberately small and neutral. The real Atlas app uses a licensed typeface
/// that isn't in this repo, so this uses the platform default. Don't spend your
/// two hours on visual design — use these and move on.
class T {
  T._();

  // ---- colour ----
  static const ink = Color(0xFF14181B); // primary text
  static const ink2 = Color(0xFF5A6467); // secondary text
  static const ink3 = Color(0xFF8A9497); // tertiary / hint
  static const paper = Color(0xFFF6F7F6); // screen background
  static const surface = Color(0xFFFFFFFF); // cards
  static const rule = Color(0xFFE1E6E1); // borders, dividers

  static const accent = Color(0xFF0B5049); // primary action
  static const accentInk = Color(0xFFFFFFFF); // text on accent
  static const accentSoft = Color(0xFFE0ECE9);

  static const positive = Color(0xFF2C6136);
  static const warning = Color(0xFF8A5B06);
  static const critical = Color(0xFF8A2E2E);
  static const criticalSoft = Color(0xFFF7E7E5);

  // ---- spacing (4pt grid) ----
  static const s1 = 4.0;
  static const s2 = 8.0;
  static const s3 = 12.0;
  static const s4 = 16.0;
  static const s5 = 24.0;
  static const s6 = 32.0;
  static const s7 = 48.0;

  static const radius = 12.0;

  // ---- type ----
  static const display = TextStyle(
      fontSize: 34, height: 1.15, fontWeight: FontWeight.w600, color: ink, letterSpacing: -0.5);
  static const title = TextStyle(
      fontSize: 22, height: 1.25, fontWeight: FontWeight.w600, color: ink, letterSpacing: -0.2);
  static const heading = TextStyle(fontSize: 17, height: 1.3, fontWeight: FontWeight.w600, color: ink);
  static const body = TextStyle(fontSize: 15, height: 1.45, color: ink);
  static const bodyMuted = TextStyle(fontSize: 15, height: 1.45, color: ink2);
  static const small = TextStyle(fontSize: 13, height: 1.4, color: ink2);
  static const label = TextStyle(
      fontSize: 11, height: 1.3, fontWeight: FontWeight.w600, color: ink3, letterSpacing: 0.8);
  static const numeric = TextStyle(
      fontSize: 15, height: 1.4, color: ink, fontFeatures: [FontFeature.tabularFigures()]);
}
