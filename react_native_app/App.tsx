import Slider from '@react-native-community/slider';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ApiClient, ApiResult, JsonObject, Persona, personas } from './src/apiClient';
import { color, radius, space, type } from './src/tokens';

type Screen =
  | { name: 'home'; refreshKey: number }
  | { name: 'request'; limitCents: number; maxIncreaseCents: number }
  | { name: 'offer'; limitCents: number; maxIncreaseCents: number }
  | { name: 'result'; result: ApiResult | null; error: string | null };

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});
const wholeCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function money(cents: number) {
  return currency.format(cents / 100);
}

function moneyWhole(cents: number) {
  return wholeCurrency.format(cents / 100);
}

// Members are in one of two experiments, decided by headroom at signup.
// Experiment 1 (headroom): A is the shipped request flow; B presents the same
// capped increase as a pre-approved offer. Experiment 2 (at their max): A shows
// nothing, as shipped; B explains that the member is at their maximum. In
// production the arm comes from assignment; here it's a demo control on Home.
type Arm = 'A' | 'B';

const armLabels = {
  headroom: { A: 'A: Request', B: 'B: Pre-approved' },
  atMax: { A: 'A: No button', B: 'B: At-max message' },
} as const;

function numberField(object: JsonObject | null, key: string) {
  const value = object?.[key];
  return typeof value === 'number' ? value : 0;
}

// Bounds the increase-requests endpoint accepts.
const MIN_INCREASE_CENTS = 10000;
const MAX_INCREASE_CENTS = 250000;
const STEP_CENTS = 5000;

// The largest increase that keeps the member at or under their maximum eligible
// limit. Anything above it is always declined, so the app never offers it.
function maxIncreaseCents(account: JsonObject | null) {
  const room = numberField(account, 'max_eligible_limit_cents') - numberField(account, 'limit_cents');
  return Math.min(MAX_INCREASE_CENTS, Math.floor(room / STEP_CENTS) * STEP_CENTS);
}

export default function App() {
  const api = useMemo(() => new ApiClient(), []);
  const [screen, setScreen] = useState<Screen>({ name: 'home', refreshKey: 0 });
  const [arm, setArm] = useState<Arm>('A');
  const showResult = (result: ApiResult | null, error: string | null) =>
    setScreen({ name: 'result', result, error });

  const goHome = () => {
    setScreen((current) => ({
      name: 'home',
      refreshKey: current.name === 'home' ? current.refreshKey + 1 : Date.now(),
    }));
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      {screen.name === 'home' ? (
        <HomePage
          api={api}
          arm={arm}
          onArmChange={setArm}
          refreshKey={screen.refreshKey}
          onRequest={(limitCents, maxIncreaseCents) =>
            setScreen(arm === 'B'
              ? { name: 'offer', limitCents, maxIncreaseCents }
              : { name: 'request', limitCents, maxIncreaseCents })}
        />
      ) : screen.name === 'request' ? (
        <RequestPage
          api={api}
          limitCents={screen.limitCents}
          maxIncreaseCents={screen.maxIncreaseCents}
          onBack={goHome}
          onResult={showResult}
        />
      ) : screen.name === 'offer' ? (
        <OfferPage
          api={api}
          limitCents={screen.limitCents}
          maxIncreaseCents={screen.maxIncreaseCents}
          onBack={goHome}
          onResult={showResult}
        />
      ) : (
        <ResultPage result={screen.result} error={screen.error} onDone={goHome} />
      )}
    </SafeAreaView>
  );
}

function HomePage({
  api,
  arm,
  onArmChange,
  refreshKey,
  onRequest,
}: {
  api: ApiClient;
  arm: Arm;
  onArmChange: (arm: Arm) => void;
  refreshKey: number;
  onRequest: (limitCents: number, maxIncreaseCents: number) => void;
}) {
  const [account, setAccount] = useState<JsonObject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [persona, setPersona] = useState<Persona>(api.persona);
  const [personaOpen, setPersonaOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    api.getCreditLine().then((response) => {
      if (!active) return;
      if (response.isSuccess) {
        setAccount(response.body);
      } else {
        setError('The API answered HTTP ' + response.statusCode + '.');
      }
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setError('Could not reach the mock API.\nIs it running? cd mock-api && npm start');
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [api, persona, refreshKey, reloadKey]);

  const choosePersona = (next: Persona) => {
    api.persona = next;
    setPersona(next);
    setPersonaOpen(false);
  };

  const limit = numberField(account, 'limit_cents');
  const spent = numberField(account, 'balance_cents');
  const available = Math.max(0, limit - spent - numberField(account, 'pending_holds_cents'));
  const alreadyRequested = account?.increase_request != null;
  const maxIncrease = maxIncreaseCents(account);
  // Members without room for the smallest increase would only ever be
  // declined, so they never get an Increase button (experiment 2).
  const canRequest = !alreadyRequested && maxIncrease >= MIN_INCREASE_CENTS;
  const atMax = account != null && !alreadyRequested && !canRequest;
  const labels = atMax ? armLabels.atMax : armLabels.headroom;

  return (
    <View style={styles.page}>
      <Text style={type.title}>Your credit line</Text>
      <View style={styles.topGap} />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={color.accent} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={[type.bodyMuted, styles.centerText]}>{error}</Text>
          <View style={styles.mediumGap} />
          <SecondaryButton label="Retry" onPress={() => setReloadKey((value) => value + 1)} />
        </View>
      ) : (
        <View style={styles.flex}>
          {atMax && arm === 'B' ? (
            <AtMaxCard limitCents={limit} availableCents={available} />
          ) : canRequest && arm === 'B' ? (
            <OfferCard
              limitCents={limit}
              maxIncreaseCents={maxIncrease}
              onPress={() => onRequest(limit, maxIncrease)}
            />
          ) : canRequest ? (
            <PrimaryButton label="Increase" onPress={() => onRequest(limit, maxIncrease)} />
          ) : null}
          <View style={styles.mediumGap} />
          <View style={styles.card}>
            <AccountRow label="Credit limit" value={money(limit)} />
            <View style={styles.divider} />
            <AccountRow label="Spent" value={money(spent)} />
          </View>
        </View>
      )}

      <View style={styles.personaRow}>
        <Text style={type.label}>ARM</Text>
        <View style={styles.segments}>
          {(['A', 'B'] as const).map((option) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: option === arm }}
              key={option}
              onPress={() => onArmChange(option)}
              style={({ pressed }) => [
                styles.segment,
                option === arm && styles.segmentSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={option === arm ? type.small : [type.small, styles.segmentIdle]}>
                {labels[option]}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.personaRow}>
        <Text style={type.label}>PERSONA</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={'Current persona: ' + persona}
          onPress={() => setPersonaOpen(true)}
          style={styles.personaButton}
        >
          <Text numberOfLines={1} style={type.small}>{persona}</Text>
          <View style={styles.chevron} />
        </Pressable>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={personaOpen}
        onRequestClose={() => setPersonaOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setPersonaOpen(false)}>
          <View style={styles.personaMenu}>
            <Text style={type.heading}>Choose a persona</Text>
            <View style={styles.smallGap} />
            {personas.map((option) => (
              <Pressable
                accessibilityRole="button"
                key={option}
                onPress={() => choosePersona(option)}
                style={({ pressed }) => [
                  styles.personaOption,
                  option === persona && styles.personaOptionSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={option === persona ? type.body : type.bodyMuted}>{option}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function RequestPage({
  api,
  limitCents,
  maxIncreaseCents,
  onBack,
  onResult,
}: {
  api: ApiClient;
  limitCents: number;
  maxIncreaseCents: number;
  onBack: () => void;
  onResult: (result: ApiResult | null, error: string | null) => void;
}) {
  const [increase, setIncrease] = useState(Math.min(50000, maxIncreaseCents));
  const { submitting, submit } = useSubmitIncrease(api, onResult);

  return (
    <View style={styles.page}>
      <BackButton onPress={onBack} />
      <Text style={type.title}>Request an increase</Text>
      <View style={styles.topGap} />
      <View style={styles.card}>
        <Text style={[type.label, styles.centerText]}>INCREASE BY</Text>
        <View style={styles.tinyGap} />
        <Text style={[type.display, styles.centerText]}>{moneyWhole(increase)}</Text>
        {maxIncreaseCents > MIN_INCREASE_CENTS ? (
          <IncreaseSlider value={increase} maxCents={maxIncreaseCents} onChange={setIncrease} />
        ) : (
          <View style={styles.mediumGap} />
        )}
        <View style={styles.smallGap} />
        <Text style={[type.small, styles.centerText]}>
          {'New limit if approved: ' + money(limitCents + increase)}
        </Text>
      </View>
      <View style={styles.mediumGap} />
      <Text style={type.bodyMuted}>
        {'You can increase your limit by up to ' + moneyWhole(maxIncreaseCents) + '.'}
      </Text>
      <View style={styles.flex} />
      <PrimaryButton
        disabled={submitting}
        label={submitting ? 'Submitting…' : 'Submit'}
        onPress={() => submit(increase)}
      />
    </View>
  );
}

function OfferCard({
  limitCents,
  maxIncreaseCents,
  onPress,
}: {
  limitCents: number;
  maxIncreaseCents: number;
  onPress: () => void;
}) {
  return (
    <View style={[styles.card, styles.offerCard]}>
      <Text style={type.label}>PRE-APPROVED</Text>
      <View style={styles.tinyGap} />
      <Text style={type.heading}>
        {'Raise your limit to ' + moneyWhole(limitCents + maxIncreaseCents)}
      </Text>
      <View style={styles.tinyGap} />
      <Text style={type.bodyMuted}>
        {"That's " + moneyWhole(maxIncreaseCents) + ' more to work with. No application needed.'}
      </Text>
      <View style={styles.mediumGap} />
      <PrimaryButton label="See your offer" onPress={onPress} />
    </View>
  );
}

function AtMaxCard({ limitCents, availableCents }: { limitCents: number; availableCents: number }) {
  return (
    <View style={styles.card}>
      <Text style={type.label}>YOUR LIMIT</Text>
      <View style={styles.tinyGap} />
      <Text style={type.heading}>{"You're at your maximum limit"}</Text>
      <View style={styles.tinyGap} />
      <Text style={type.bodyMuted}>
        {'Your maximum was set when you joined, and your ' + moneyWhole(limitCents) +
          " limit has reached it, so an increase isn't available on this account."}
      </Text>
      <View style={styles.smallGap} />
      <Text style={type.bodyMuted}>
        {"Nothing here checks your credit, and there's nothing you need to do."}
      </Text>
      <View style={styles.divider} />
      <AccountRow label="Available to spend" value={money(availableCents)} />
    </View>
  );
}

function OfferPage({
  api,
  limitCents,
  maxIncreaseCents,
  onBack,
  onResult,
}: {
  api: ApiClient;
  limitCents: number;
  maxIncreaseCents: number;
  onBack: () => void;
  onResult: (result: ApiResult | null, error: string | null) => void;
}) {
  const [increase, setIncrease] = useState(maxIncreaseCents);
  const [choosing, setChoosing] = useState(false);
  const { submitting, submit } = useSubmitIncrease(api, onResult);

  return (
    <View style={styles.page}>
      <BackButton onPress={onBack} />
      <Text style={type.title}>{"You're pre-approved"}</Text>
      <View style={styles.topGap} />
      <View style={styles.card}>
        <Text style={[type.label, styles.centerText]}>NEW CREDIT LIMIT</Text>
        <View style={styles.tinyGap} />
        <Text style={[type.display, styles.centerText]}>{moneyWhole(limitCents + increase)}</Text>
        <View style={styles.tinyGap} />
        <Text style={[type.small, styles.centerText]}>
          {'Up from ' + moneyWhole(limitCents) + ' (+' + moneyWhole(increase) + ')'}
        </Text>
        {choosing ? (
          <IncreaseSlider value={increase} maxCents={maxIncreaseCents} onChange={setIncrease} />
        ) : null}
      </View>
      {!choosing && maxIncreaseCents > MIN_INCREASE_CENTS ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => setChoosing(true)}
          style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
        >
          <Text style={styles.linkText}>Choose a smaller amount</Text>
        </Pressable>
      ) : null}
      <View style={styles.mediumGap} />
      <Text style={type.bodyMuted}>
        Accepting runs a soft inquiry, which won't affect your credit score. Your new limit is
        ready to use right away.
      </Text>
      <View style={styles.flex} />
      <PrimaryButton
        disabled={submitting}
        label={submitting ? 'Accepting…' : 'Accept ' + moneyWhole(limitCents + increase) + ' limit'}
        onPress={() => submit(increase)}
      />
    </View>
  );
}

function IncreaseSlider({
  value,
  maxCents,
  onChange,
}: {
  value: number;
  maxCents: number;
  onChange: (cents: number) => void;
}) {
  return (
    <>
      <Slider
        accessibilityLabel="Increase amount"
        maximumTrackTintColor={color.rule}
        maximumValue={maxCents / 100}
        minimumTrackTintColor={color.accent}
        minimumValue={MIN_INCREASE_CENTS / 100}
        onValueChange={(dollars) => onChange(Math.round(dollars * 100))}
        step={STEP_CENTS / 100}
        style={styles.slider}
        thumbTintColor={color.accent}
        value={value / 100}
      />
      <View style={styles.sliderBounds}>
        <Text style={type.small}>{moneyWhole(MIN_INCREASE_CENTS)}</Text>
        <Text style={type.small}>{moneyWhole(maxCents)}</Text>
      </View>
    </>
  );
}

function useSubmitIncrease(
  api: ApiClient,
  onResult: (result: ApiResult | null, error: string | null) => void,
) {
  const [submitting, setSubmitting] = useState(false);

  const submit = async (increaseCents: number) => {
    setSubmitting(true);
    try {
      const result = await api.submitIncreaseRequest(increaseCents);
      setSubmitting(false);
      onResult(result, null);
    } catch {
      setSubmitting(false);
      onResult(null, 'Could not reach the mock API.');
    }
  };

  return { submitting, submit };
}

function ResultPage({
  result,
  error,
  onDone,
}: {
  result: ApiResult | null;
  error: string | null;
  onDone: () => void;
}) {
  let headline = 'Request not sent';
  let detail = result && typeof result.body.message === 'string'
    ? result.body.message
    : result
      ? 'The API answered HTTP ' + result.statusCode + '.'
      : 'Please try again later.';

  if (error || !result || result.statusCode >= 500) {
    headline = 'Something went wrong';
    detail = 'Please try again later.';
  } else if (result.body.status === 'APPROVED') {
    headline = 'Approved';
    detail = typeof result.body.new_limit_cents === 'number'
      ? 'Your new limit is ' + money(result.body.new_limit_cents) + '.'
      : 'Your limit went up.';
  } else if (result.body.status === 'DECLINED') {
    headline = 'Declined';
    detail = "We can't increase your limit right now.";
  }

  return (
    <View style={styles.page}>
      <View style={styles.resultTopGap} />
      <Text style={type.title}>{headline}</Text>
      <View style={styles.smallGap} />
      <Text style={type.bodyMuted}>{detail}</Text>
      <View style={styles.flex} />
      <PrimaryButton label="Back to Home" onPress={onDone} />
    </View>
  );
}

function AccountRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.accountRow}>
      <Text style={type.bodyMuted}>{label}</Text>
      <Text style={type.numeric}>{value}</Text>
    </View>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel="Back"
      accessibilityRole="button"
      hitSlop={12}
      onPress={onPress}
      style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
    >
      <Text style={styles.backGlyph}>‹</Text>
    </Pressable>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        disabled && styles.primaryButtonDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
    >
      <Text style={type.body}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: color.paper,
  },
  page: {
    alignSelf: 'center',
    backgroundColor: color.paper,
    flex: 1,
    padding: space.s5,
    width: '100%',
    maxWidth: 560,
  },
  flex: { flex: 1 },
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  centerText: { textAlign: 'center' },
  topGap: { height: space.s5 },
  resultTopGap: { height: space.s7 },
  mediumGap: { height: space.s4 },
  smallGap: { height: space.s2 },
  tinyGap: { height: space.s1 },
  card: {
    backgroundColor: color.surface,
    borderColor: color.rule,
    borderRadius: radius,
    borderWidth: 1,
    padding: space.s4,
  },
  accountRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  divider: {
    backgroundColor: color.rule,
    height: 1,
    marginVertical: space.s4 / 2,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: color.accent,
    borderRadius: radius,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: space.s4,
    paddingVertical: space.s3,
  },
  primaryButtonDisabled: { opacity: 0.45 },
  primaryButtonText: {
    ...type.body,
    color: color.accentInk,
    fontWeight: '600',
  },
  secondaryButton: {
    borderColor: color.rule,
    borderRadius: radius,
    borderWidth: 1,
    paddingHorizontal: space.s4,
    paddingVertical: space.s2,
  },
  pressed: { opacity: 0.72 },
  slider: {
    height: 44,
    marginTop: space.s2,
    width: '100%',
  },
  sliderBounds: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  offerCard: {
    backgroundColor: color.accentSoft,
    borderColor: color.accentSoft,
  },
  linkButton: {
    alignSelf: 'center',
    marginTop: space.s3,
    minHeight: 44,
    justifyContent: 'center',
  },
  linkText: {
    ...type.body,
    color: color.accent,
    fontWeight: '600',
  },
  segments: {
    flex: 1,
    flexDirection: 'row',
    gap: space.s2,
    justifyContent: 'flex-end',
  },
  segment: {
    borderColor: color.rule,
    borderRadius: radius,
    borderWidth: 1,
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: space.s3,
  },
  segmentSelected: {
    backgroundColor: color.accentSoft,
    borderColor: color.accent,
  },
  segmentIdle: { color: color.ink3 },
  backButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    marginBottom: space.s2,
    marginLeft: -space.s2,
    width: 36,
  },
  backGlyph: {
    color: color.ink,
    fontSize: 36,
    lineHeight: 36,
  },
  personaRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  personaButton: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    minHeight: 40,
  },
  chevron: {
    borderBottomColor: color.ink2,
    borderBottomWidth: 2,
    borderRightColor: color.ink2,
    borderRightWidth: 2,
    height: 8,
    marginLeft: space.s2,
    marginTop: -4,
    transform: [{ rotate: '45deg' }],
    width: 8,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(20, 24, 27, 0.35)',
    flex: 1,
    justifyContent: 'center',
    padding: space.s5,
  },
  personaMenu: {
    backgroundColor: color.surface,
    borderColor: color.rule,
    borderRadius: radius,
    borderWidth: 1,
    maxWidth: 420,
    padding: space.s4,
    width: '100%',
  },
  personaOption: {
    borderRadius: radius,
    minHeight: 44,
    paddingHorizontal: space.s3,
    paddingVertical: space.s3,
  },
  personaOptionSelected: { backgroundColor: color.accentSoft },
});
