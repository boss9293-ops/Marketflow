// =============================================================================
// SectionIntro  (WO-SA19)
// Compact 1-line section description. Always visible, always subdued.
// =============================================================================

interface Props {
  text: string
  style?: React.CSSProperties
}

export default function SectionIntro({ text, style }: Props) {
  return (
    <p style={{
      margin:     0,
      color:      '#4B5563',
      fontSize:   '0.65rem',
      lineHeight: 1.45,
      fontWeight: 400,
      ...style,
    }}>
      {text}
    </p>
  )
}
