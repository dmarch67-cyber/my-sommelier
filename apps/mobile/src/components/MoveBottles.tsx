import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Stepper } from './controls';
import { Button, Card, Chip, T } from './ui';
import { moveSizes, type DrinkChoice } from '../logic/adding';
import { space } from '../lib/theme';

export type MoveRequest = {
  fromCellarId: string;
  toCellarId: string;
  toCellarName: string;
  sizeMl: number;
  sizeLabel: string;
  count: number;
};

/**
 * The "Move bottles" card on the Wine page: from one cellar, pick the size (only
 * when there is more than one), the cellar they go to and how many.
 */
export function MoveBottles({
  fromCellarId,
  fromCellarName,
  choices,
  cellars,
  busy,
  onMove,
  onCancel,
}: {
  fromCellarId: string;
  fromCellarName: string;
  choices: DrinkChoice[];
  cellars: { id: string; name: string }[];
  busy: boolean;
  onMove: (req: MoveRequest) => void;
  onCancel: () => void;
}) {
  const sizes = moveSizes(choices, fromCellarId);
  const targets = cellars.filter((c) => c.id !== fromCellarId);
  const [sizeMl, setSizeMl] = useState(sizes[0]?.sizeMl ?? 750);
  const [toId, setToId] = useState<string | null>(targets.length === 1 ? targets[0].id : null);
  const [count, setCount] = useState(1);

  const size = sizes.find((s) => s.sizeMl === sizeMl) ?? sizes[0];
  const max = size?.bottles ?? 0;
  const to = targets.find((c) => c.id === toId) ?? null;
  const n = Math.min(count, max);
  const what = size && size.sizeMl !== 750 ? size.sizeLabel.toLowerCase() : 'bottle';

  return (
    <Card style={{ marginTop: space.md, gap: space.md }}>
      <T variant="bodyStrong">Move bottles from {fromCellarName}</T>

      {sizes.length > 1 && (
        <View style={{ gap: space.xs }}>
          <T variant="caption">Which size?</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {sizes.map((s) => (
              <Chip
                key={s.sizeMl}
                label={`${s.sizeLabel} (${s.bottles})`}
                selected={s.sizeMl === sizeMl}
                onPress={() => {
                  setSizeMl(s.sizeMl);
                  setCount((c) => Math.min(c, s.bottles));
                }}
              />
            ))}
          </View>
        </View>
      )}

      <View style={{ gap: space.xs }}>
        <T variant="caption">To which cellar?</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {targets.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              selected={c.id === toId}
              onPress={() => setToId(c.id)}
            />
          ))}
        </View>
      </View>

      <View style={{ gap: space.xs }}>
        <T variant="caption">
          How many? {max} {max === 1 ? what : `${what}s`} in {fromCellarName}
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Stepper value={n} onChange={setCount} min={1} max={max} />
          {max > 1 && (
            <Chip label={`All ${max}`} selected={n === max} onPress={() => setCount(max)} />
          )}
        </View>
      </View>

      <Button
        label={
          to
            ? `Move ${n} ${n === 1 ? what : `${what}s`} to ${to.name}`
            : 'Choose a cellar to move to'
        }
        disabled={!to || max === 0}
        loading={busy}
        onPress={() =>
          to &&
          size &&
          onMove({
            fromCellarId,
            toCellarId: to.id,
            toCellarName: to.name,
            sizeMl: size.sizeMl,
            sizeLabel: size.sizeLabel,
            count: n,
          })
        }
      />
      <Pressable
        onPress={onCancel}
        accessibilityRole="button"
        style={{ alignSelf: 'center', padding: space.sm }}
      >
        <T variant="caption">Cancel</T>
      </Pressable>
    </Card>
  );
}
