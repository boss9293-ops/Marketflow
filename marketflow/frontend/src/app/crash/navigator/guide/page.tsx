import Link from 'next/link'

export default function CrashNavigatorGuidePage() {
  return (
    <main style={{
      minHeight: '100vh',
      background: '#0a0f1a',
      color: '#e5e7eb',
      fontFamily: "var(--font-ui-sans, var(--font-terminal), 'Nanum Gothic Coding', 'Noto Sans KR', monospace)",
      padding: '2.6rem 1.95rem',
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
        <div style={{
          background: '#111318',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14,
          padding: '1.6rem 1.8rem',
        }}>
          <div style={{ fontSize: '1.9rem', fontWeight: 800, marginBottom: 6 }}>?덈쾭由ъ? 湲몃뱾?닿린 ?ъ슜 媛?대뱶</div>
          <div style={{ fontSize: '0.95rem', color: '#cbd5f5' }}>
            ?덈쾭由ъ???媛뺣젰???꾧뎄?낅땲?? 洹몃윭???듭젣?섏? ?딆쑝硫?移섎챸?곸씪 ???덉뒿?덈떎. 蹂?怨듦컙? ?덈쾭由ъ?瑜??듭젣?섎뒗 ?덉감? ?먯튃???쒓났?⑸땲??
          </div>
        </div>

        <div style={{ display: 'grid', gap: '1rem' }}>
          <section style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1.1rem 1.2rem' }}>
            <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 6 }}>?닿쾬? 臾댁뾿?멸?</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.92rem', lineHeight: 1.6 }}>
              <li>???붿쭊? ?쒕??섎? 留욎텛??AI?앷? ?꾨떃?덈떎.</li>
              <li>?꾩옱 ?쒖옣???대뼡 援?㈃?몄?(媛??諛⑹뼱/?⑤땳/?덉젙??援ъ“??瑜?遺꾨쪟?⑸땲??</li>
              <li>洹?援?㈃?먯꽌 ?쒖?湲?????/ ?섏? 留??쇄앹쓣 紐낇솗???쒖떆?⑸땲??</li>
            </ul>
          </section>

          <section style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1.1rem 1.2rem' }}>
            <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 6 }}>?닿쾬? 臾댁뾿???댁＜?붽?</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.92rem', lineHeight: 1.6 }}>
              <li>Acting Point(?됰룞 ?쒖젏)瑜??쒓났?⑸땲??</li>
              <li>Trigger Distance(?꾧퀎移섍퉴吏 ?⑥? 嫄곕━)瑜?蹂댁뿬以띾땲??</li>
              <li>湲됰씫 ?곸쐞 ?쇱꽱????듦퀎???꾩튂)??洹쇨굅濡??쒖떆?⑸땲??</li>
              <li>?κ린 ?섎씫??STRUCTURAL)?먯꽌???됰룞 鍮덈룄瑜??쒗븳??硫섑깉 ?쇰줈瑜?以꾩엯?덈떎.</li>
            </ul>
          </section>

          <section style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1.1rem 1.2rem' }}>
            <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 6 }}>?닿쾬? 臾댁뾿???섏? ?딅뒗媛</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.92rem', lineHeight: 1.6 }}>
              <li>?쒖?湲덉씠 諛붾떏/怨좎젏?앹쓣 ?⑥젙?섏? ?딆뒿?덈떎.</li>
              <li>?쒕컲?쒖떆 諛섎벑/諛섎뱶???섎씫??媛숈? ?덉뼵???섏? ?딆뒿?덈떎.</li>
              <li>鍮좊Ⅸ 媛??섎씫(?쇨컙 ??씫)? 100% 諛⑹뼱?????놁뒿?덈떎.</li>
            </ul>
          </section>

          <section style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1.1rem 1.2rem' }}>
            <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 6 }}>3?④퀎 ?ъ슜踰?(媛??以묒슂)</div>
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              <div>
                <div style={{ fontSize: '0.92rem', fontWeight: 600 }}>1) WATCH(媛??二쇱쓽)</div>
                <div style={{ fontSize: '0.9rem', color: '#cbd5f5' }}>?좉퇋 留ㅼ닔 以묐떒 쨌 諛⑹뼱 以鍮?二쇰Ц/怨꾪쉷 ?뺤씤)</div>
              </div>
              <div>
                <div style={{ fontSize: '0.92rem', fontWeight: 600 }}>2) DEFENSE(?앹〈 紐⑤뱶)</div>
                <div style={{ fontSize: '0.9rem', color: '#cbd5f5' }}>?먯궛 蹂댄샇媛 紐⑺몴 쨌 怨꾪쉷??鍮꾩쑉濡?異뺤냼, 愿留??꾪솚</div>
              </div>
              <div>
                <div style={{ fontSize: '0.92rem', fontWeight: 600 }}>3) STABILIZATION(?덉젙??</div>
                <div style={{ fontSize: '0.9rem', color: '#cbd5f5' }}>
                  10% ?먯깋 ??5% 異붽? ??議곌굔 ?뺤씤 ???④퀎 ?뺣? 쨌 fake bounce???뺤긽?대ŉ, 洹쒖튃?濡??쒖옞??愿留앪앹쑝濡?蹂듦?
                </div>
              </div>
            </div>
          </section>

          <section style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1.1rem 1.2rem' }}>
            <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 6 }}>硫섑깉 ?덉젙 怨꾩빟 (Psychology Contract)</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.92rem', lineHeight: 1.6 }}>
              <li>吏湲덉쓽 紐⑺몴???쒖닔??洹밸??붴앷? ?꾨땲???쒗뙆??諛⑹?? ?щ━ ?덉젙?앹엯?덈떎.</li>
              <li>遺덊솗?ㅼ꽦? ?뺤긽?낅땲?? ?쒖뒪?쒖? ?뺣쪧怨?洹쇨굅濡?留먰빀?덈떎.</li>
              <li>媛먯젙??異⑸룞(?⑤땳 留ㅻ룄/異붽꺽 留ㅼ닔)??以꾩씠??寃껋씠 ?κ린?곸쑝濡?媛??以묒슂?⑸땲??</li>
              <li>?쒓퀎?띾맂 ?덉감媛 吏꾪뻾 以묅앹씠?쇰뒗 ?좏샇 ?먯껜媛 ?덉젙媛먯쓣 以띾땲??</li>
            </ul>
          </section>

          <section style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1.1rem 1.2rem' }}>
            <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 6 }}>硫댁콉 諛?二쇱쓽</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.92rem', lineHeight: 1.6 }}>
              <li>?ъ옄 ?먮Ц???꾨떃?덈떎. ?먯떎 媛?μ꽦???덉뒿?덈떎.</li>
              <li>?덈쾭由ъ? ?곹뭹? 蹂?숈꽦??留ㅼ슦 ?щŉ, ?④린媛????먯떎??諛쒖깮?????덉뒿?덈떎.</li>
              <li>蹂??쒖뒪?쒖? ?뺣낫 ?쒓났 諛??섏궗寃곗젙 蹂댁“ 紐⑹쟻?대ŉ, 理쒖쥌 梨낆엫? ?ъ슜?먯뿉寃??덉뒿?덈떎.</li>
            </ul>
          </section>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
          <Link
            href="/crash/navigator"
            style={{
              background: '#0f1116',
              color: '#e5e7eb',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 10,
              padding: '0.5rem 0.9rem',
              fontSize: '0.85rem',
              textDecoration: 'none',
            }}
          >
            Navigator濡??뚯븘媛湲?          </Link>
          <div style={{ fontSize: '0.78rem', color: '#7b8499' }}>?쒖? 留ㅻ돱??v1.0 (Balanced)</div>
        </div>
      </div>
    </main>
  )
}

