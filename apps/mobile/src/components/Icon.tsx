import Svg, { Circle, Path } from 'react-native-svg';

import { colors } from '../lib/theme';

export type IconName =
  | 'glass'
  | 'cellar'
  | 'plus'
  | 'note'
  | 'mic'
  | 'search'
  | 'back'
  | 'close'
  | 'chevron'
  | 'camera'
  | 'image'
  | 'mail';

/** A small hand-drawn icon set (line icons, 24px grid). */
export function Icon({
  name,
  size = 22,
  color = colors.text,
  strokeWidth = 1.8,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const p = {
    stroke: color,
    strokeWidth,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      {name === 'glass' && (
        <>
          <Path d="M7 3h10l-.6 6.2A4.4 4.4 0 0 1 12 13.2a4.4 4.4 0 0 1-4.4-4L7 3Z" {...p} />
          <Path d="M12 13.2V20M8.5 20.5h7" {...p} />
        </>
      )}
      {name === 'cellar' && (
        <>
          <Path d="M4 20V9l8-5 8 5v11" {...p} />
          <Circle cx="9" cy="13" r="1.6" {...p} />
          <Circle cx="15" cy="13" r="1.6" {...p} />
          <Circle cx="9" cy="17.4" r="1.6" {...p} />
          <Circle cx="15" cy="17.4" r="1.6" {...p} />
        </>
      )}
      {name === 'plus' && <Path d="M12 5v14M5 12h14" {...p} />}
      {name === 'note' && (
        <>
          <Path d="M6 3.5h9l3 3v14H6z" {...p} />
          <Path d="M9 10h6M9 13.5h6M9 17h4" {...p} />
        </>
      )}
      {name === 'mic' && (
        <>
          <Path
            d="M12 3.5a2.8 2.8 0 0 1 2.8 2.8v5.2a2.8 2.8 0 0 1-5.6 0V6.3A2.8 2.8 0 0 1 12 3.5Z"
            {...p}
          />
          <Path d="M6.5 11.2a5.5 5.5 0 0 0 11 0M12 16.8v3.7" {...p} />
        </>
      )}
      {name === 'search' && (
        <>
          <Circle cx="10.8" cy="10.8" r="6" {...p} />
          <Path d="m15.3 15.3 4.2 4.2" {...p} />
        </>
      )}
      {name === 'back' && <Path d="M15 5l-7 7 7 7" {...p} />}
      {name === 'chevron' && <Path d="M9.5 6l6 6-6 6" {...p} />}
      {name === 'camera' && (
        <>
          <Path
            d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.5-2h5.6l1.5 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9Z"
            {...p}
          />
          <Circle cx={12} cy={13} r={3.5} {...p} />
        </>
      )}
      {name === 'image' && (
        <>
          <Path d="M5 5h14v14H5z" {...p} />
          <Circle cx={9.5} cy={9.5} r={1.5} {...p} />
          <Path d="M5 16l4.5-4.5L14 16l2-2 3 3" {...p} />
        </>
      )}
      {name === 'mail' && (
        <>
          <Path d="M4 6.5h16v11H4z" {...p} />
          <Path d="M4.5 7l7.5 6 7.5-6" {...p} />
        </>
      )}
      {name === 'close' && <Path d="M6.5 6.5l11 11M17.5 6.5l-11 11" {...p} />}
    </Svg>
  );
}
