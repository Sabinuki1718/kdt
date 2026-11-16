/* King of Dorcus titanus — battle engine (DOM-free)
   すべての調整値は CONFIG / CHARS / SKILLS / SPECIALS に集約。 */
(function (root) {
'use strict';

const CONFIG = {
  ruleVer: 6,             // 対戦ルールの版。数値や処理を変えたら上げる（kdt_master.json と同じ値に）。通信対戦は同じ版どうしだけ
  kiaiMax: 10,
  kiaiStart: 4,
  turnTime: 15,          // 秒
  turnTimeShort: 10,     // 選択時間短縮を受けた時
  maxTurns: 30,          // ターン上限（1ターン最長約30秒 × 30 ＝ 約15分）。超えたら HP の割合で判定
  net: { reconnectGrace: 10, reconnectMax: 3 },   // 通信対戦：切断からの再接続猶予（秒/回）と、1試合で猶予を受けられる回数
  meterStepMs: 170,      // 目押しメーター 1目盛りの時間
  meterFastMul: 0.8,     // 目押し妨害時（約20%高速化）
  specialMax: 100,
  // 内歯適性：攻勢値補正（pow）・ダメージ倍率（dmg）・気合の実消費軽減（save）
  //   fit = 適性技（得意） / off = 非適性技（省エネ） / center = 中央型（両方）
  tooth: {
    fit:    { pow: 1, dmg: 1.15, save: 0 },
    off:    { pow: 0, dmg: 0.80, save: 1 },
    center: { pow: 1, dmg: 1.00, save: 0 },
  },
  // 同じ技の連続使用によるダメージ減衰。index = 連続回数-1、以降は最後の値
  streakDmg: [1.00, 0.95, 0.88, 0.60, 0.40],
  streakPow: [0, -1, -2],   // 同じ技の連続使用による攻勢の低下（2回目 -1、3回目以降 -2）。index = 連続回数-1、以降は最後の値
  streakWarnAt: 4,       // この回数から「見切られている」表示
  dmgScale: 1.3,         // 全体のダメージ倍率（試合時間の調整用）
  marginBonus: 0.04,     // 攻勢値差1ごとの勝者ダメージ補正
  marginCap: 5,
  chip:      [ { maxDiff: 1, ratio: 0.25 }, { maxDiff: 3, ratio: 0.10 } ],   // それ以上の差は 0
  chipSkill: [ { maxDiff: 2, ratio: 0.35 }, { maxDiff: 4, ratio: 0.20 }, { maxDiff: 99, ratio: 0.10 } ],
  guardReduce: 0.5,      // ガードを貫通された時のダメージ倍率
  guardRefund: 1,        // ガード成功時の気合返還
  specialGuardRatio: 0.15, // 必殺をガードされた時に通るダメージ
  specialKiaiBonus: 0.04,  // 必殺に投入した気合1ごとのダメージ補正
  mashTime: 2.4,         // 競り合い（秒）
  mashDrawRatio: 0.5,
  cpuMashRate: [6.2, 8.6], // CPU の連打速度（回/秒）
  statTotal: 300,        // 戦闘力 + 技巧 の合計
  surplusHp: 0.18,
  surplusHpCap: 30,      // 余剰技巧HPボーナスの上限       // 余剰技巧1あたりのHPボーナス
  spDrainAmt: 20,        // すくい崩し：必殺ゲージ減少量
  kanaDeclDmg: 2,        // 金蚉の宣告：宣言通りに出した時の威力倍率
  kanaLieTaken: 1.3,     // 金蚉の宣告：嘘をついて負けた時の被ダメージ倍率（さらに気合 -1）
  kanaMash: 1.5,         // 金蚉の加護：競り合いの連打の重み
  ai: { kiaiValue: 2.1, defW: 1.05, killBonus: 260, guardLockCost: -5 /* 負の値＝ガードを選びやすくする（CPUのガード率 約2割） */, specialCost: 9, holdValue: 0.12, killHold: 0.45 /* 温存型の必殺（魁）：ガードを誘って次のターンに撃つ価値 */, baitValue: 0.5, holdDecay: 0.35, guardPrior: 0.5,
        oppKiaiMu: 0.55, oppKiaiSigma: 1.9, histPrior: 3, transPrior: 1.5, kiaiPrior: 3, bluff: 0.25, declTrust: 0.67, temp: { easy: 7, normal: 3.2, hard: 1.6 } },
};

/* 戦闘力（格）：100〜200 の20刻み6階級。数値は実ステータスの倍率ではなく、下の表で基本性能を引く。 */
const RANKS = {
  //        HP   火力   体格攻勢 ガード  必殺ゲージ（毎ターン/与ダメ/被ダメ/ガード成功・開始値・使用後）
  100: { hp: 108, atk: 0.90, basePow: 0, guardPow: 1, sp: { perTurn: 9, hit: 9, hurt: 11, guard: 5, start: 15, after: 35 } },
  120: { hp: 128, atk: 1.00, basePow: 0, guardPow: 1, sp: { perTurn: 8, hit: 9, hurt: 10, guard: 5, start: 10, after: 30 } },
  140: { hp: 152, atk: 1.05, basePow: 0, guardPow: 1, sp: { perTurn: 7, hit: 9, hurt: 9,  guard: 4, start: 5,  after: 20 } },
  160: { hp: 158, atk: 1.03, basePow: 1, guardPow: 2, sp: { perTurn: 6, hit: 8, hurt: 8,  guard: 4, start: 0,  after: 10 } },
  180: { hp: 190, atk: 1.13, basePow: 1, guardPow: 2, sp: { perTurn: 5, hit: 8, hurt: 7,  guard: 3, start: 0,  after: 0 } },
  200: { hp: 235, atk: 1.22, basePow: 1, guardPow: 3, sp: { perTurn: 5, hit: 8, hurt: 6,  guard: 3, start: 0,  after: 0 } },
};
/* ステータスタイプ */
const STYPES = {
  balance: { name: 'バランス型', hp: 1.00, atk: 1.00, regen: 0, desc: '補正なし。' },
  attack:  { name: '攻撃型',     hp: 0.90, atk: 1.08, regen: 0, desc: '攻撃性能アップ・HPダウン。' },
  stamina: { name: '体力型',     hp: 1.25, atk: 0.95, regen: 0, desc: 'HPアップ・攻撃性能ダウン。' },
  kiai:    { name: '気合型',     hp: 0.66, atk: 0.88, regen: 1, desc: '気合の自然回復 +1（毎ターン+3）・HPと攻撃性能ダウン。' },
};
const BASE_REGEN = 2;

/* 種の定義。戦闘力・タイプ・内歯・必殺だけを書き、実ステータスは deriveChar() で決まる。
   技巧 = 300 − 戦闘力。技は「必要技巧」以下なら装備できる。 */
const CHARS = {
  palawan:  { name: 'パラワンオオヒラタ', epithet: '無双の豪勇', short: 'パラワン', sci: 'Dorcus titanus palawanicus', range: 'フィリピン・パラワン島',
              rating: 200, stype: 'attack', tooth: 'down', special: 'guillotine',
              trait: { chip: [ { maxDiff: 1, ratio: 0.40 }, { maxDiff: 3, ratio: 0.22 }, { maxDiff: 5, ratio: 0.10 } ], guardChip: 0.22, guardPierce: 0.6 },
              blurb: '最高クラスの通常火力と基礎攻勢値を持つ、最強候補No.1。競り負けても、ガードされても、相手を削り続ける。',
              note: 'パラワン島周辺に分布する最大級の亜種。長く伸びる大アゴが特徴。大型個体は110mmを超える。',
              model: { mandLen: 1.55, curve: 0.10, headW: 1.08 } },
  teiou:    { name: 'テイオウヒラタ', epithet: '天衝く帝王', short: 'テイオウ', sci: 'Dorcus titanus imperialis', range: 'フィリピン・カタンドゥアネス島',
              rating: 200, stype: 'attack', tooth: 'up', special: 'teiou',
              blurb: '帝王の名を持つ大型種。内歯上がり最高クラスの戦闘力。',
              note: 'カタンドゥアネス島産のフィリピンヒラタの通称。内歯上がりとしては最大級で、大型個体は100mmを超える。',
              model: { mandLen: 1.45, curve: 0.16, headW: 1.12 } },
  aceh:     { name: 'スマトラオオヒラタ（アチェ）', epithet: '黒鋼の覇者', short: 'アチェ', sci: 'Dorcus titanus yasuokai', range: 'インドネシア・スマトラ島北部（アチェ）',
              rating: 200, stype: 'balance', tooth: 'down', special: 'aceh',
              blurb: '分厚い体と太い大アゴ。攻防一体で隙がない、最強候補のヒラタ。',
              note: 'スマトラ島に分布する重量級の亜種。重厚な体躯と力強い大アゴを持ち、とりわけたくましい。',
              model: { mandLen: 1.4, curve: 0.13, headW: 1.12 } },
  bengkulu: { name: 'スマトラオオヒラタ（ベンクール）', epithet: '不屈の黒鋼', short: 'ベンクール', sci: 'Dorcus titanus yasuokai', range: 'インドネシア・スマトラ島南西部（ベンクール）',
              rating: 180, stype: 'stamina', tooth: 'up', special: 'bengkulu',
              blurb: '分厚い体と太い大アゴを持つスマトラオオヒラタの産地違い。持久戦に強い。',
              note: 'スマトラ島南西部、ベンクール産のスマトラオオヒラタ。本産地は内歯が上がる傾向がある。',
              model: { mandLen: 1.3, curve: 0.15, headW: 1.08 } },
  sulawesi: { name: 'スラウェシオオヒラタ', epithet: '南蛮の狂刃', short: 'スラウェシ', sci: 'Dorcus titanus typhon', range: 'インドネシア・スラウェシ島',
              rating: 180, stype: 'attack', tooth: 'up', special: 'sulawesi', spMod: { perTurn: 3, hit: 2, hurt: 2 },
              blurb: '必殺火力は最強クラス。ハイリスクハイリターンな必殺技が特徴。',
              note: 'スラウェシ島に分布する亜種。内歯上がり、細身の体躯を持つ。スラリと細長く伸びる大アゴが特徴。',
              model: { mandLen: 1.5, curve: 0.09, headW: 0.98 } },
  marinduque:{ name: 'マリンドッケオオヒラタ', epithet: '絶海の無敵要塞', short: 'マリンドッケ', sci: 'Dorcus titanus imperialis', range: 'フィリピン・ボアク島',
              rating: 180, stype: 'stamina', tooth: 'down', special: 'marinduque',
              blurb: '持久戦を得意とする難攻不落の要塞。あらゆる攻撃を受け止めて、押し潰す。',
              note: 'ボアク（旧マリンドッケ）島産のフィリピンヒラタの通称。この産地の個体は太く重量感のある体躯が特徴。',
              model: { mandLen: 1.25, curve: 0.12, headW: 1.1 } },
  tsushima: { name: 'ツシマヒラタ', epithet: '海峡の武人', short: 'ツシマ', sci: 'Dorcus titanus castanicolor', range: '日本（長崎県・対馬）',
              rating: 160, stype: 'attack', tooth: 'down', special: 'tsushima',
              blurb: '日本産最大級。中量級ながら大型種にも迫る火力を持つ。',
              note: '対馬に分布する亜種。日本国内のヒラタクワガタとしては最大クラス。',
              model: { mandLen: 1.2, curve: 0.12, headW: 1.04 } },
  sakishima:{ name: 'サキシマヒラタ', epithet: '南風ぬチューバー', short: 'サキシマ', sci: 'Dorcus titanus sakishimanus', range: '日本（沖縄県・先島諸島）',
              rating: 160, stype: 'balance', tooth: 'center', special: 'sakishima',
              blurb: '日本産最大級のヒラタ。上下どちらの技も安定して扱える、バランスの取れた性能。',
              note: '先島諸島に分布する亜種。日本国内のヒラタクワガタとしては最も太くたくましい。',
              model: { mandLen: 1.1, curve: 0.15, headW: 1.0 } },
  goto:     { name: 'ゴトウヒラタ', epithet: '五島の荒波', short: 'ゴトウ', sci: 'Dorcus titanus karasuyamai', range: '日本（長崎県・五島列島）',
              rating: 140, stype: 'kiai', tooth: 'down', special: 'goto',
              blurb: '気合効率の良い中型種。毎ターン+3の気合で、投入量の読み合いを有利に運ぶ。',
              note: '五島列島に分布する亜種。ツシマヒラタよりもやや太くなる傾向がある。',
              model: { mandLen: 1.05, curve: 0.13, headW: 1.0 } },
  amami:    { name: 'アマミヒラタ', epithet: '麗しき秘宝', short: 'アマミ', sci: 'Dorcus titanus elegans', range: '日本（鹿児島県・奄美大島及び周辺離島）',
              rating: 140, stype: 'stamina', tooth: 'center', special: 'amami',
              blurb: '持久戦に強い中型種。粘り強く、上下どちらの技も使いこなす。削りに強い。',
              note: '奄美大島とその周辺離島に分布する亜種。上翅にうっすらと筋が入るのが特徴。',
              model: { mandLen: 1.0, curve: 0.16, headW: 1.0 } },
  hondo:    { name: 'ホンドヒラタ', epithet: '不屈の大和魂', short: 'ホンド', sci: 'Dorcus titanus pilifer', range: '日本（本州・四国・九州）',
              rating: 120, stype: 'balance', tooth: 'down', special: 'kagenui', spMod: { perTurn: 4, hurt: 4 },
              blurb: 'バランスの取れた性能の小型種。必殺ゲージが溜まりやすく、必殺を防がれてもすぐに次のチャンスが来る。技の選択肢も非常に多い。',
              note: '日本で最も身近なヒラタクワガタ。西日本では多く見られるが、東日本には少ない。',
              model: { mandLen: 0.95, curve: 0.16, headW: 1.0 } },
  miyazaki: { name: 'ホンドヒラタ（宮崎）', epithet: '日向の剣士', short: 'ミヤザキ', battleName: 'ホンドヒラタ', battleShort: 'ホンド', sci: 'Dorcus titanus pilifer', range: '日本（宮崎県）',
              rating: 120, stype: 'balance', tooth: 'center', special: 'miyazaki', hpMod: 14,
              blurb: '内歯中央のバランス型。上下どちらの技も安定し、必殺で気合を取り戻して読み合いを続ける。',
              note: 'ホンドヒラタのうち、宮崎県産の個体には内歯がやや上がり気味につくものがいる。',
              model: { mandLen: 0.98, curve: 0.16, headW: 1.0 } },
  okinawa:  { name: 'オキナワヒラタ', epithet: '美ら島ぬ守り手', short: 'オキナワ', sci: 'Dorcus titanus okinawanus', range: '日本（沖縄県・沖縄島及び周辺離島）',
              rating: 120, stype: 'stamina', tooth: 'down', special: 'okinawa', spMod: { perTurn: 10, hurt: 4 },
              blurb: '小型種ながら打たれ強い。技の選択肢も多く、回転の速い必殺技で逆転のチャンスを狙おう。',
              note: '沖縄島とその周辺離島に分布する亜種。やや太めの体格と、湾曲する大アゴが特徴。',
              model: { mandLen: 0.92, curve: 0.13, headW: 1.0 } },
  okinoerabu:{ name: 'オキノエラブヒラタ', epithet: '蒼海の奇策士', short: 'オキノエラブ', sci: 'Dorcus titanus okinoerabuensis', range: '日本（鹿児島県・沖永良部島）',
              rating: 120, stype: 'kiai', tooth: 'down', special: 'okinoerabu',
              blurb: '気合管理の得意な小型種。豊富な気合で、試合展開をこちらのペースに持ち込もう。',
              note: '沖永良部島に分布する亜種。大アゴの裏に金色の微毛が密生するという、唯一無二の個性を持つ。',
              model: { mandLen: 0.9, curve: 0.14, headW: 0.98 } },
  daito:    { name: 'ダイトウヒラタ', epithet: '変幻自在の紅', short: 'ダイトウ', sci: 'Dorcus titanus daitoensis', range: '日本（沖縄県・北大東島/南大東島）',
              rating: 100, stype: 'kiai', tooth: 'down', special: 'daito',
              blurb: '最小級。だが最高値の技巧で全ての技を使いこなせる。気合の管理と技の組み合わせが全て。',
              note: '大東諸島に分布する亜種。ワインレッドのような深い赤みが特徴。全亜種中最小級。',
              model: { mandLen: 0.85, curve: 0.13, headW: 0.98 } },
  manado:   { name: 'マナドオオヒラタ', epithet: '原点にして頂点', short: 'マナド', sci: 'Dorcus titanus titanus', range: 'インドネシア・スラウェシ島北部（マナド）',
              rating: 180, stype: 'balance', tooth: 'down', special: 'manado',
              blurb: 'ティタヌスの名を冠する原名亜種。癖のないバランス型で、必殺は相手の必殺ゲージを打ち消す。',
              note: 'スラウェシ島北部に分布する原名亜種。北部の港町マナドの名で呼ばれ、ヒラタクワガタ種群の基準となる亜種。',
              model: { mandLen: 1.35, curve: 0.12, headW: 1.06 } },
  malay:    { name: 'マレーオオヒラタ', epithet: '密林の巨神', short: 'マレー', sci: 'Dorcus titanus nobuyukii', range: 'マレー半島（マレーシア）、ボルネオ島',
              rating: 180, stype: 'stamina', tooth: 'down', special: 'malay',
              blurb: '打たれ強い体力型の大型。与えたダメージで回復しながら、じわじわと押し切る。',
              note: 'マレー半島・ボルネオ島に分布する亜種。大アゴの発達が良く、太く重量感のある体つきになる。光沢もやや強い。',
              model: { mandLen: 1.3, curve: 0.13, headW: 1.08 } },
  nueva:    { name: 'ネバービスカヤオオヒラタ', epithet: '山脈を分かつ者', short: 'ネバービスカヤ', sci: 'Dorcus titanus imperialis', range: 'フィリピン・ルソン島（ヌエバ・ビスカヤ州）',
              rating: 180, stype: 'attack', tooth: 'center', special: 'nueva', hpMod: 24,
              blurb: '内歯中央の攻撃型大型。上下どちらでも重く、弱った相手を必殺の一撃で仕留めにかかる。',
              note: 'フィリピン・ルソン島北部の山岳地帯、ヌエバ・ビスカヤ州産のフィリピンヒラタの通称。ルソン島産は内歯位置の変異が大きい。',
              model: { mandLen: 1.34, curve: 0.11, headW: 1.07 } },
  mindanao: { name: 'ミンダナオオオヒラタ', epithet: '火山島の剛王', short: 'ミンダナオ', sci: 'Dorcus titanus mindanaoensis', range: 'フィリピン・ミンダナオ島',
              rating: 180, stype: 'balance', tooth: 'down', special: 'mindanao',
              blurb: '癖のないバランス型の大型。火山の鳴動のごとき一撃で、相手の次の攻めを押し返す。',
              note: 'フィリピン南部、ミンダナオ島に分布する大型の亜種。内歯は下がりだが、他のフィリピン産亜種に比べると若干前方に付く傾向がある。',
              model: { mandLen: 1.3, curve: 0.12, headW: 1.06 } },
  westermann:{ name: 'ウェスターマンヒラタ（ドイサケット）', epithet: '山岳の古豪', short: 'ドイサケット', battleName: 'ウェスターマンヒラタ', battleShort: 'ウェスターマン', sci: 'Dorcus titanus westermanni', range: 'タイ北部（チェンマイ県ドイサケット）',
              rating: 160, stype: 'stamina', tooth: 'down', special: 'westermann', hpMod: -10,
              blurb: '打たれ強い体力型の中量級。粘り強く耐え、必殺の一撃のあと、追撃をさらに重くする。',
              note: 'インドシナ半島に広く分布するウェスターマンヒラタのうち、内歯が下がるタイ北部の個体群。',
              model: { mandLen: 1.2, curve: 0.13, headW: 1.03 } },
  westermannTak:{ name: 'ウェスターマンヒラタ（ターク）', epithet: '巌の古豪', short: 'ターク', battleName: 'ウェスターマンヒラタ', battleShort: 'ウェスターマン', sci: 'Dorcus titanus westermanni', range: 'タイ西部（ターク県）',
              rating: 160, stype: 'stamina', tooth: 'center', special: 'westermannTak', hpMod: -14,
              blurb: '内歯中央の体力型。どちらの技も安定して使え、必殺のあとは守りを固めて粘り勝つ。',
              note: 'ウェスターマンヒラタのうち、ミャンマー国境に近いタイ西部の個体群は内歯がやや上がる傾向がある。',
              model: { mandLen: 1.16, curve: 0.15, headW: 1.04 } },
  vietnam:  { name: 'ベトナムヒラタ', epithet: '熱帯の狩人', short: 'ベトナム', sci: 'Dorcus titanus fafner', range: 'ベトナム',
              rating: 160, stype: 'attack', tooth: 'down', special: 'vietnam',
              blurb: '攻撃型の中量級。弱った相手を一気に仕留める必殺を持つ。',
              note: 'ベトナムに分布するヒラタクワガタ。ウェスターマンより細く、中国より太い傾向がある。内歯の発達が良い。',
              model: { mandLen: 1.2, curve: 0.12, headW: 1.02 } },
  fasolt:   { name: 'ファソルトヒラタ', epithet: '半島の長槍', short: 'ファソルト', sci: 'Dorcus titanus castanicolor', range: '朝鮮半島',
              rating: 160, stype: 'attack', tooth: 'down', special: 'fasolt',
              trait: { guardChip: 0.2 },
              blurb: '攻撃型の中量級。長いリーチを持ち、完全にガードされても大アゴの先が届く。必殺のあとは勢いに乗って攻め立てる。',
              note: 'ツシマヒラタの朝鮮半島の個体群（※分類には諸説あり）。ツシマヒラタよりも、体格も大アゴもさらに細長い傾向があるとされる。',
              model: { mandLen: 1.36, curve: 0.10, headW: 0.97, lengthMul: 1.06 } },
  chugoku:  { name: 'チュウゴクヒラタ', epithet: '大陸の拳豪', short: 'チュウゴク', sci: 'Dorcus titanus platymelus', range: '中国',
              rating: 140, stype: 'attack', tooth: 'down', special: 'chugoku', hpMod: 40, trait: { sealHit: 3, sealPierce: 0.75 },
              blurb: '攻撃型の中型。下がり技・上がり技が命中すると、相手がそのターンに出した技を3ターン封印する。封印中の相手には、ガードされても威力の75%が通る（通常は攻勢で上回っても50%）。',
              note: '中国に広く分布する亜種。ホンドより細いがツシマより太い傾向がある。産地によりその形態には変異が大きい。',
              model: { mandLen: 1.05, curve: 0.14, headW: 1.0 } },
  unnan:    { name: 'ウンナンヒラタ', epithet: '雲上の剣客', short: 'ウンナン', sci: 'Dorcus titanus typhoniformis', range: '中国（雲南省・貴州省・広西壮族自治区）',
              rating: 140, stype: 'kiai', tooth: 'up', special: 'unnan',
              blurb: '数少ない内歯上がりの気合型。岩をも砕く一太刀は、ガードの上からも届き、命中すれば気合を奪う。',
              note: '雲南省をはじめ、中国東部の一部地域に分布する亜種。細めの体格だが、内歯が前方に付く傾向がある。',
              model: { mandLen: 1.1, curve: 0.15, headW: 1.0 } },
  tokunoshima:{ name: 'トクノシマヒラタ', epithet: '荒ぶる闘牛', short: 'トクノシマ', sci: 'Dorcus titanus tokunoshimaensis', range: '日本（鹿児島県・徳之島）',
              rating: 140, stype: 'balance', tooth: 'center', special: 'tokunoshima', hpMod: 22,
              trait: { guardChip: 0.4, guardPierce: 0.9 },   // ガードブレイカー：完全に受け止められても40%、ガードを破れば90%が通る
              blurb: '内歯中央のバランス型。必殺技を逆に相手にガードさせることで真価を発揮する。',
              note: '徳之島に分布する亜種。アマミヒラタに酷似するが、上翅の筋がやや不明瞭な傾向がある。',
              model: { mandLen: 1.0, curve: 0.15, headW: 1.0 } },
  iki:      { name: 'イキヒラタ', epithet: '意気揚々の一番槍', short: 'イキ', sci: 'Dorcus titanus tatsutai', range: '日本（長崎県・壱岐）',
              rating: 140, stype: 'attack', tooth: 'down', special: 'iki', kiaiStart: 10, spSet: { start: 100, after: 0 }, spMod: { perTurn: -4, hit: -5, hurt: -5, guard: -3 },
              blurb: '1ターン目から必殺がMAX。気合ゲージも10スタート。必殺は1ターン目が最大威力で、待つほど弱まる。撃った後の必殺ゲージは0%からで、とてもたまりにくい。前半戦に全てを賭けた速攻型。',
              note: '壱岐島に分布する亜種。ツシマヒラタに似て細い体形、細長い大アゴを持つが、ツシマヒラタほど大アゴは伸長しない傾向がある。',
              model: { mandLen: 1.05, curve: 0.13, headW: 1.0 } },
  taiwan:   { name: 'タイワンヒラタ', epithet: '麗島の小龍', short: 'タイワン', sci: 'Dorcus titanus sika', range: '台湾',
              rating: 120, stype: 'balance', tooth: 'down', special: 'taiwan', hpMod: 10, trait: { absorbDown: 25 },
              blurb: 'バランス型の小型。下がり技が命中するたび、相手の必殺ゲージを25%奪って自分に加える。必殺も相手のゲージを奪い取る。',
              note: '台湾に分布する亜種。太短い体格を持つが、あまり大型化しない。褐色を帯びた個体が多くみられる。',
              model: { mandLen: 0.95, curve: 0.14, headW: 1.0 } },
  takara:   { name: 'タカラヒラタ', epithet: '禁忌の財宝', short: 'タカラ', sci: 'Dorcus titanus takaraensis', range: '日本（鹿児島県・トカラ列島 宝島）',
              rating: 120, stype: 'attack', tooth: 'down', special: 'takara', hpMod: 28, trait: { sutemiDown: { pow: 1, self: 3 } },
              blurb: '小型ながら攻撃型。下がり技は攻勢 +1 だが、命中するたび自分も HP を3失う。必殺も自らを傷つける禁断の大技。',
              note: 'トカラ列島の宝島・小宝島に分布する亜種。太短い体格を持ち、後脚にトゲを持たない。島の条例で採集が禁止されている。',
              model: { mandLen: 0.95, curve: 0.14, headW: 1.0 } },
  hachijoA: { name: 'ハチジョウヒラタ（A型）', epithet: '三位一体の影法師', short: 'ハチジョウA', battleName: 'ハチジョウヒラタ', battleShort: 'ハチジョウ', hideTooth: true, sci: 'Dorcus titanus hachijoensis', range: '日本（東京都・八丈島）',
              rating: 100, stype: 'balance', tooth: 'down', special: 'hachijo', hpMod: 20,
              blurb: '対戦画面上では型名は表示されない。よく観察すれば気づけるが、内歯込みのカスタマイズの豊富さが特徴。',
              note: '八丈島に分布する亜種。国産ヒラタの中でも発生時期が早い。内歯が下につくA型が基本形とされる。',
              model: { mandLen: 0.85, curve: 0.14, headW: 0.98 } },
  hachijoB: { name: 'ハチジョウヒラタ（B型）', epithet: '三位一体の影法師', short: 'ハチジョウB', battleName: 'ハチジョウヒラタ', battleShort: 'ハチジョウ', hideTooth: true, sci: 'Dorcus titanus hachijoensis', range: '日本（東京都・八丈島）',
              rating: 100, stype: 'balance', tooth: 'up', special: 'hachijo', hpMod: 20,
              blurb: '対戦画面上では型名は表示されない。よく観察すれば気づけるが、内歯込みのカスタマイズの豊富さが特徴。',
              note: '八丈島に分布する亜種。内歯が上に付く個体が出やすいエリアがあり、内歯が上がるものはB型と呼ばれる。',
              model: { mandLen: 0.85, curve: 0.14, headW: 0.98 } },
  hachijoAB:{ name: 'ハチジョウヒラタ（AB型）', epithet: '三位一体の影法師', short: 'ハチジョウAB', battleName: 'ハチジョウヒラタ', battleShort: 'ハチジョウ', hideTooth: true, sci: 'Dorcus titanus hachijoensis', range: '日本（東京都・八丈島）',
              rating: 100, stype: 'balance', tooth: 'center', special: 'hachijo', hpMod: 20,
              blurb: '対戦画面上では型名は表示されない。よく観察すれば気づけるが、内歯込みのカスタマイズの豊富さが特徴。',
              note: '八丈島に分布する亜種。A型とB型の中間形。内歯が中央のものは、AB型と呼ばれる。',
              model: { mandLen: 0.85, curve: 0.14, headW: 0.98 } },
};

/* 技は全キャラ共通。gikou = 必要技巧（キャラの技巧がこれ以上なら装備可）。
   下がり技 = 攻撃力ボーナス重視 / 上がり技 = 補助効果重視（ただしシンプルな高性能技もある）
   type: 'up' | 'down'   fx: 効果ID   tag: 系統表示 */
const SKILLS = {
  // --- 下がり技：火力 ---
  jihibiki:     { name: '地響き押し',   type: 'down', pow: 1, dmg: 14, tag: '妨害', fx: 'pushHit', gikou: 120, desc: '命中した次ターン、相手の攻勢値 -1。' },
  oshitsubushi: { name: '押し潰し',     type: 'down', pow: 1, dmg: 17, tag: '標準',   gikou: 100, desc: '素直に重い下がり技。' },
  sokojikara:   { name: '底力の押し潰し', type: 'down', pow: 1, dmg: 17, tag: '高火力', fx: 'comeback', mul: 1.45, gikou: 140, desc: '自分のHP割合が相手より低いと、威力1.45倍。' },
  fumishime:    { name: '硬化突き', type: 'down', pow: 1, dmg: 13, tag: '自己強化', fx: 'brace', taken: 0.8, gikou: 120, desc: '使ったターン、受けるダメージ -20%（打ち負けても軽減）。' },
  agoPress:     { name: '大顎プレス',   type: 'down', pow: 0, dmg: 22, tag: '高火力', gikou: 100, desc: '攻勢値は低いが成功時の威力が高い。' },
  juuatsu:      { name: '重圧押し込み', type: 'down', pow: 1, dmg: 14, tag: '標準', fx: 'chip', gikou: 100, desc: '競り負けてもダメージを残しやすい。' },
  // --- 下がり技：補助 ---
  kaeshi:       { name: '恨み返し',     type: 'down', pow: 2, dmg: 9,  tag: '高火力', fx: 'grudge', mul: 2, gikou: 160, desc: '通常の威力は低いが、前のターンに負けていると威力2倍（ガードされただけなら対象外）。' },
  kaifukuFuji:  { name: '気合挫き',     type: 'down', pow: 2, dmg: 12, tag: '妨害', fx: 'regenBlock', gikou: 180, desc: '命中した次ターン、相手の気合自然回復 -1。' },
  jirashi:      { name: '焦らし押し', type: 'down', pow: 2, dmg: 12, tag: '妨害', fx: 'timeCut', gikou: 180, desc: '命中した次ターン、相手の選択時間 15秒→10秒。' },
  kihakuOshi:   { name: '気迫押し',     type: 'down', pow: 2, dmg: 13, tag: '自己強化', fx: 'spBoost', sp: 12, gikou: 180, desc: '命中時、自分の必殺ゲージ +12%。' },
  // --- 下がり技：カナブン（技巧140） ---
  midoriKago:   { name: '金蚉の加護',   type: 'down', pow: 2, powKana: 3, dmg: 13, tag: '自己強化', fx: 'kanaGuard', turns: 3, gikou: 140, desc: '命中時、カナブンを呼ぶ（3ターン）。いる間はこの技の攻勢 2→3、攻勢負けの削りダメージを受けず、競り合いの連打が1.5倍。ただし気合の自然回復 -1。いる間に当てても残りターンは延びない（3ターンでいったん去る）。' },
  // --- 下がり技：捨て身（技巧160） ---
  haisui:       { name: '背水の刃', type: 'down', pow: 3, dmg: 21, tag: '高火力', fx: 'equipRegenDown', gikou: 160, desc: '攻勢も威力も高いが、装備している間ずっと気合の自然回復 -1。' },
  // --- 体力型向け（技巧140） ---
  funbari:      { name: '踏ん張り返し', type: 'down', pow: 1, dmg: 14, tag: '自己強化', fx: 'healHit', heal: 8, gikou: 140, desc: '命中時、自分のHPを8回復。' },
  // --- テクニカル（技巧180・200）：相手の行動を読んで刺す ---
  sakiyomi:     { name: '先読み崩し',   type: 'down', pow: 1, dmg: 13, tag: '自己強化', fx: 'readDown', amt: 3, gikou: 160, desc: '相手が下がり技を出していたら、攻勢値 +3。' },
  naraku:       { name: '奈落落とし',   type: 'down', pow: 0, dmg: 30, tag: '高火力', fx: 'selfLock', gikou: 180, desc: '攻勢は低いが、威力がとても高い。使った次のターン、ガードを使えない。' },
  gekirin:      { name: '起死回生',   type: 'down', pow: 2, dmg: 13, tag: '高火力', fx: 'comeback', gikou: 200, desc: '自分のHP割合が相手より低いと、威力1.5倍。' },
  kiaiShibori:  { name: '気合絞り',     type: 'down', pow: 2, dmg: 12, tag: '妨害', fx: 'drain1', amt: 2, gikou: 200, desc: '命中時、相手の残り気合 -2（連続で使うと -1、3回目以降は 0）。' },
  // --- 上がり技：シンプル高性能 ---
  ugachi:       { name: '穿ち上げ',     type: 'up',   pow: 3, dmg: 6, piercePct: 0.15, tag: '対ガード', fx: 'guardPierce', gikou: 120, desc: '通常の威力はとても低いが、相手がガードしていたら、防御の上から相手の最大HPの15%のダメージを与える。' },
  oshiage:      { name: '押し上げ返し', type: 'up',   pow: 4, dmg: 5,  tag: '対ガード', guardPush: 2, gikou: 120, desc: '攻勢値が高く威力は低い。相手がガードしていたら（受け止められても、破っても）、相手の次ターンの攻勢値 -2。' },
  tekkeKachiage:{ name: '鉄壁かち上げ', type: 'up',   pow: 3, dmg: 11, tag: '標準', gikou: 100, desc: '攻勢値が高く競り負けにくい。' },
  gouSukui:     { name: '剛顎すくい',   type: 'up',   pow: 2, dmg: 18, tag: '高火力', gikou: 100, desc: '上がり技としては威力が高い。' },
  tentsuki:     { name: '天衝き',       type: 'up',   pow: 1, dmg: 26, tag: '高火力', gikou: 100, desc: '攻勢値は低いが成功時の威力が高い。' },
  // --- 上がり技：補助 ---
  haneokoshi:   { name: '気合投げ',   type: 'up',   pow: 3, dmg: 9,  tag: '自己強化', fx: 'selfKiai', gikou: 140, desc: '命中時、自分の気合 +1。' },
  tenkuzushi:   { name: '天崩し',       type: 'up',   pow: 0, dmg: 28, tag: '高火力', fx: 'brace', taken: 1.3, gikou: 180, desc: '攻勢は低いが、威力がとても高い。使ったターン、受けるダメージ +30%。' },
  kiaiKezuri:   { name: '気合削り', type: 'up',   pow: 3, dmg: 11, tag: '妨害', fx: 'drain1', amt: 2, gikou: 180, desc: '命中時、相手の残り気合 -2（連続で使うと -1、3回目以降は 0）。' },
  sukuiKuzushi: { name: 'すくい崩し',   type: 'up',   pow: 3, dmg: 9,  tag: '妨害', fx: 'spDrain', gikou: 140, desc: '命中時、相手の必殺ゲージ -20%。' },
  futokoro:     { name: '見切り投げ',   type: 'up',   pow: 2, dmg: 10, tag: '自己強化', fx: 'readUp', amt: 3, gikou: 160, desc: '相手が上がり技を出していたら、攻勢値 +3。' },
  memai:        { name: '目眩まし投げ', type: 'up',   pow: 3, dmg: 10, tag: '妨害', fx: 'meterFast', gikou: 180, desc: '命中した次ターン、相手の目押しメーターが約20%速くなる。' },
  koukaku:      { name: '甲冑固め',     type: 'up',   pow: 3, dmg: 10, tag: '自己強化', fx: 'brace', gikou: 140, desc: '使ったターン、受けるダメージ -30%（打ち負けても軽減）。' },
  guardBreak:   { name: '守り崩し',     type: 'up',   pow: 3, dmg: 12, tag: '対ガード', fx: 'guardKiai', gikou: 160, desc: '相手がガードしていたら、自分の気合 +2。' },
  hissatsuKasoku:{ name: '気迫の瞬撃', type: 'up',   pow: 3, dmg: 9,  tag: '自己強化', fx: 'spBoost', gikou: 160, desc: '命中時、自分の必殺ゲージ +20%。' },
  kokuu:        { name: '虚空すくい',   type: 'up',   pow: 2, dmg: 9,  tag: '自己強化', fx: 'lowKiai', gikou: 200, desc: '投入気合が1以下なら攻勢値 +3。少ない気合で読みを外す。' },
  midoriSenkoku:{ name: '金蚉の宣告',   type: 'up',   pow: 3, dmg: 12, tag: '自己強化', fx: 'kanaDeclare', turns: 3, gikou: 180, desc: '命中時、カナブンを呼ぶ（3ターン）。いる間は毎ターン、行動と気合を宣言してから選ぶ。宣言通りなら与えるダメージ ×2。嘘をついて負けると、受けるダメージ +30%・気合 -1、カナブンも去る（ガードされただけなら罰なし）。' },
  ikigire:      { name: '気合切らせ',     type: 'up',   pow: 3, dmg: 9,  tag: '妨害', fx: 'regenBlock', gikou: 200, desc: '命中した次ターン、相手の気合自然回復 -1。' },
};

/* 必殺：dmg は合計威力。何回に分けて当てるか（連撃数）は演出側（index.html の SP_W）で決める。name=技名、ruby=読み。
   ガードされた／必殺同士で打ち負けた時は追加効果なし（貫通ダメージ・不発時の効果・原初の王者のゲージ消去は例外）。
   相手の気合に干渉する（drain）のは気合型だけ。fx = 固有効果 */
const SPECIALS = {
  guillotine: { name: '巨顎断頭', ruby: 'ギガントギロチン', pow: 9, dmg: 46, desc: '超重量の締め上げ。合計威力は全種最高。' },
  teiou: { name: '帝王の裁き', ruby: 'エンペラー・ジャッジメント', pow: 9, dmg: 40, fx: 'guardBreak', desc: '命中すると、相手は次のターン ガードできない。' },
  aceh: { name: '黒鋼圧壊', ruby: 'アイアンブレイカー', pow: 9, dmg: 44, fx: 'pierce', guardRatio: 0.3, desc: 'ガードされても威力の30%が通る。' },
  bengkulu: { name: '黒鋼轟砕', ruby: 'アイアンクラッシャー', pow: 8, dmg: 36, fx: 'pierce', guardRatio: 0.4, desc: 'ガードされても威力の40%が通る。' },
  sulawesi: { name: '狂戦士の双牙', ruby: 'バーサーク・デュアルファング', pow: 8, dmg: 52, fx: 'berserk', recoilTaken: 1.3,
                desc: '威力はトップクラス。ただしガードされる／必殺同士で打ち負けると、次のターン ガード不可＆被ダメージ1.3倍。' },
  marinduque: { name: '海神の重圧', ruby: 'オケアノス・ヘヴィプレス', pow: 8, dmg: 36, fx: 'guardStock', desc: '命中時、一度だけ2回連続でガード可能な権利が得られる（権利は最大1つまで）。' },
  tsushima: { name: '誉れの一太刀', ruby: 'ほまれのひとたち', pow: 8, dmg: 34, fx: 'honor', mul: 1.45, desc: '自分のHP割合が相手より低いと、威力1.45倍。' },
  sakishima: { name: 'ハイムルブシ', ruby: 'はいむるぶし', pow: 8, dmg: 36, fx: 'tailwind', powUp: 1, turns: 2, desc: '命中時、2ターン 自分の攻勢値+1' },
  goto: { name: '三舞颪・五島灘', ruby: 'さんまいおろし・ごとうなだ', pow: 7, dmg: 33, drain: 2, desc: '命中時、相手の気合を2奪う。' },
  amami: { name: '黒潮の舞・雅', ruby: 'くろしおのまい・みやび', pow: 7, dmg: 32, fx: 'chipImmune', turns: 3, desc: '命中時、3ターン 攻勢負け時の削りダメージが無効。' },
  kagenui: { name: '天羽々斬', ruby: 'あめのはばきり', pow: 7, dmg: 33, fx: 'spRefund', refund: 69, retryPow: 3, desc: 'ガードされる／必殺同士で打ち負けて不発に終わると、必殺ゲージが99%から再開し、次のターン 攻勢 +3。' },
  okinawa: { name: 'ティンガーラ', ruby: 'てぃんがーら', pow: 7, dmg: 30, fx: 'shield', taken: 0.7, turns: 3, heal: 60, desc: '命中時、HPを60回復し、3ターンの間 受けるダメージ-30%。' },
  okinoerabu: { name: '金毛一閃・世ノ主', ruby: 'きんもういっせん・よのぬし', pow: 7, dmg: 30, drain: 2, fx: 'regenBlock', desc: '命中時、相手の気合を2奪い、次のターンの自然回復も-1。' },
  daito: { name: '切々舞『紅』', ruby: 'きりきりまい・くれない', pow: 6, dmg: 32, fx: 'kiaiSwap', desc: '相手の気合を0にし、自分の気合を10にする。ガードされた場合は、この効果は発動しない。' },
  manado:     { name: '我こそは原初の王者', ruby: 'キング・オブ・ドルクス・ティタヌス', pow: 8, dmg: 38, fx: 'spWipe', desc: '相手の必殺ゲージを0にする。この効果だけは、ガードされても必殺同士で打ち負けても発動する。' },
  malay:      { name: '密林の呪縛', ruby: 'ジャングル・ホールド', pow: 8, dmg: 36, fx: 'drainHp', ratio: 0.5, desc: '与えたダメージの半分だけ、自分のHPを回復する。' },
  westermann: { name: '古豪の一撃', ruby: 'ソーク・クラブ', pow: 8, dmg: 34, fx: 'comboNext', mul: 1.4, desc: '命中時、次のターンの自分の技の威力1.4倍。' },
  vietnam:    { name: '熱帯の猛襲', ruby: 'トロピカル・ラッシュ', pow: 8, dmg: 33, fx: 'execute', th: 0.35, mul: 1.6, desc: '相手のHPが35%以下なら、威力1.6倍。' },
  chugoku:    { name: '炸裂拳', ruby: 'サクレツケン', pow: 7, dmg: 36, fx: 'sealCmd', turns: 3, desc: '命中時、相手の得意技を3ターン封印（使えない）。中央型が相手なら、最後に出した下がり技/上がり技を封印。' },
  unnan:      { name: '破岩斬', ruby: 'ハガンザン', pow: 7, dmg: 30, drain: 2, fx: 'pierce', guardRatio: 0.45, desc: '命中時、相手の気合を2奪う。ガードされても威力の45%が通る。' },
  tokunoshima:{ name: '闘牛の猛進', ruby: 'とうぎゅうのもうしん', pow: 7, dmg: 27, fx: 'guardCrush', guardMul: 1.9, desc: '普通に当てると必殺火力は低い。だがガードに合わせて出すと大型並みの火力が出る。' },
  iki:        { name: '先手必勝『魁』', ruby: 'せんてひっしょう・さきがけ', pow: 7, dmg: 86, fx: 'decay', decay: 0.1, floor: 0.4, aiHold: true, desc: '試合開始時から撃てる。1ターン目が最大威力で、撃たずに待つと1ターンごとに威力 -10%。撃った後は必殺ゲージ 0% から、とても溜まりにくい。' },
  taiwan:     { name: '画竜点睛', ruby: 'ガリョウテンセイ', pow: 7, dmg: 32, fx: 'spSteal', amt: 30, desc: '命中時、相手の必殺ゲージを30%奪い、自分の使用後ゲージに上乗せする。' },
  takara:     { name: '触れざる秘宝', ruby: 'ふるるべからず', pow: 7, dmg: 38, fx: 'taboo', selfDmg: 6, desc: '小型とは思えない威力だが、命中時に自分もHPを6失う。' },
  nueva:      { name: '大山脈裁断', ruby: 'マウンテン・スプラッター', pow: 8, dmg: 36, fx: 'toothSeal', turns: 2, centerPow: -2, desc: '命中時、2ターン相手の得意技/省エネの有利な補正がなくなる。中央型の相手には、代わりに2ターン 攻勢値-2。' },
  westermannTak: { name: '古豪の巌壁', ruby: 'モン・ヤン・ラック', pow: 8, dmg: 32, fx: 'fortress', taken: 0.7, desc: '命中時、次のターンに受けるダメージ-30%。' },
  fasolt:     { name: '飛燕の長牙', ruby: 'ティオヨプメチギ', pow: 8, dmg: 34, fx: 'tailwind', powUp: 2, desc: '命中時、次のターン 自分の攻勢値+2。' },
  miyazaki:   { name: '山姥切', ruby: 'やまんばきり', pow: 7, dmg: 30, fx: 'spRefund', refund: 60, retryPow: 1, desc: 'ガードされる／必殺同士で打ち負けて不発に終わると、必殺ゲージが90%から再開し、次のターン 攻勢 +1。' },
  mindanao:   { name: '大火山の脈動', ruby: 'ボルカニック・クエイク', pow: 8, dmg: 36, fx: 'spRefund', refund: 60, desc: 'ガードされる／必殺同士で打ち負けて不発に終わると、必殺ゲージが60%から再開する。' },
  hachijo:    { name: '影縫い連牙・三連', ruby: 'かげぬいれんが・さんれん', pow: 6, dmg: 33, drain: 1, spHalf: true, fx: 'tailwind', powUp: 2, desc: '命中時、相手の気合を1奪い、必殺ゲージを半分にする。さらに、次のターン 自分の攻勢値+2。' },
};
function spFull(sp) { return sp.ruby ? `${sp.name}《${sp.ruby}》` : sp.name; }

/* 戦闘力・タイプから実ステータスを決定（CHARS に書き込む） */
function deriveChar(id) {
  const c = CHARS[id], r = RANKS[c.rating], t = STYPES[c.stype];
  c.id = id;
  c.gikou = CONFIG.statTotal - c.rating;
  c.hp = Math.round(r.hp * t.hp) + (c.hpMod || 0);   // hpMod：キャラ個別のHP補正（内部パラメータ）
  c.atk = +(r.atk * t.atk).toFixed(3);
  c.basePow = r.basePow; c.guardPow = r.guardPow;
  c.regen = BASE_REGEN + t.regen;
  c.sp = { ...r.sp };
  if (c.spMod) for (const k in c.spMod) c.sp[k] = Math.max(0, c.sp[k] + c.spMod[k]);   // キャラ個別の必殺ゲージ補正
  if (c.spSet) Object.assign(c.sp, c.spSet);
  c.pool = { up: [], down: [] };
  for (const sid in SKILLS) if (SKILLS[sid].gikou <= c.gikou) c.pool[SKILLS[sid].type].push(sid);
  // 3Dモデル：戦闘力からサイズ、内歯タイプから内歯位置
  const k = (c.rating - 100) / 100;
  c.model = Object.assign({ scale: 0.8 + 0.52 * k, toothSize: 1 + 0.25 * k, lengthMul: 0.96 + 0.04 * k,
    toothPos: c.tooth === 'up' ? 0.6 : c.tooth === 'center' ? 0.45 : 0.24 }, c.model);
  return c;
}
function deriveAll() { for (const id in CHARS) deriveChar(id); }
deriveAll();
/* 余剰技巧 → HPボーナス（装備した2技それぞれの「キャラ技巧 − 必要技巧」） */
function hpBonus(charId, upId, downId) {
  const c = CHARS[charId];
  const sur = [upId, downId].reduce((sum, sid) => sum + Math.max(0, c.gikou - SKILLS[sid].gikou), 0);
  return Math.min(CONFIG.surplusHpCap, Math.round(sur * CONFIG.surplusHp));
}

const CMD_LABEL = { up: '上がり技', down: '下がり技', guard: 'ガード', special: '必殺' };

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* 毎ターンの自然回復量（装備による補正込み）：背水の刃を装備していると常に -1 */
function regenOf(f) {
  const eq = [SKILLS[f.up], SKILLS[f.down]].filter(Boolean);
  return charOf(f).regen - eq.filter(sk => sk.fx === 'equipRegenDown').length - (f.kanaG > 0 ? 1 : 0);
}
/* 総戦闘力 = 基礎戦闘力 + 装備した2技の威力（技カードに表示される威力）の合計。
   攻勢値や特殊効果は含めない「見た目の強さ」 */
function totalPower(charId, upId, downId) {
  const f = { charId, up: upId, down: downId };
  return CHARS[charId].rating + (upId ? baseDamage(f, 'up') : 0) + (downId ? baseDamage(f, 'down') : 0);
}
function makeFighter(charId, upId, downId) {
  const c = CHARS[charId], hp = c.hp + hpBonus(charId, upId, downId);
  return {
    charId, up: upId, down: downId,
    hp, maxHp: hp, kiai: c.kiaiStart != null ? c.kiaiStart : CONFIG.kiaiStart, sp: c.sp.start,
    guardLocked: false, lockSelf: false, guardStock: 0,   // lockSelf：自分のガードによる連続不可（マリンドッケの権利で解除できる）
    chipImmune: 0, toothSeal: 0,   // 削りダメージ無効・内歯の有利補正封じ の残りターン
    lastCmd: null, streak: 0, lastAtk: null, cmdSeal: null,   // lastAtk＝最後に出した上がり/下がり技、cmdSeal＝封印中の技 { cmd, n }
      // 直前に使ったコマンドと、その連続回数
    spHeld: 0,                  // 必殺を撃てるのに温存したターン数（公開情報）
    hist: { n: 0, cmd: {}, after: {}, kf: {} },   // これまでに出した行動の記録（公開情報）：回数・直前の行動ごとの次の行動・気合の入れ具合
    guardObs: { n: 0, g: 0 },   // 自分の必殺がMAXの時、相手がガードした回数（相手の癖の観察。公開情報）
    debuff: { meterFast: false, timeCut: false },
    kanaU: 0, kanaG: 0, decl: null, declObs: { n: 0, h: 0 },   // カナブン（宣告・加護）の残りターン、今ターンの宣言、宣言を守った回数（公開情報）
    buff: { takenMul: 1, pow: 0 },   // 必殺の固有効果による次ターンの補正（公開情報）
    stats: { specials: 0, dealt: 0 },
  };
}
function newBattle(f0, f1) { return { turn: 1, f: [f0, f1], over: false, winner: null }; }
function cloneState(st) { return JSON.parse(JSON.stringify(st)); }
function charOf(f) { return CHARS[f.charId]; }
function skillOf(f, cmd) { return cmd === 'up' ? SKILLS[f.up] : cmd === 'down' ? SKILLS[f.down] : null; }
function specialReady(f) { return f.sp >= CONFIG.specialMax; }
function allowedCmds(f) {
  const r = ['up', 'down'].filter(c => !(f.cmdSeal && f.cmdSeal.n > 0 && f.cmdSeal.cmd === c));   // 封印中の技は出せない
  if (!f.guardLocked || (f.lockSelf && f.guardStock > 0)) r.push('guard');   // 権利があれば、自分のガード直後でももう一度ガードできる
  if (specialReady(f) && !f.spSealed) r.push('special');
  return r;
}
/* 内歯適性：'fit' | 'off' | 'center' | null */
function fitOf(tooth, cmd) {
  if (cmd !== 'up' && cmd !== 'down') return null;
  if (tooth === 'center') return 'center';
  return tooth === cmd ? 'fit' : 'off';
}
function toothMod(f, cmd) {
  const k = fitOf(charOf(f).tooth, cmd); if (!k) return { pow: 0, dmg: 1, save: 0 };
  const t = CONFIG.tooth[k];
  if (f.toothSeal > 0 && k !== 'center') return { pow: Math.min(0, t.pow), dmg: Math.min(1, t.dmg), save: 0 };
  return t;
}
function toothBonus(tooth, cmd) { const k = fitOf(tooth, cmd); return k ? CONFIG.tooth[k].pow : 0; }
/* このコマンドを今使った場合の連続回数 */
function streakFor(f, cmd) {
  if (cmd !== 'up' && cmd !== 'down') return 0;
  return f.lastCmd === cmd ? f.streak + 1 : 1;
}
function streakMul(n) { const t = CONFIG.streakDmg; return n <= 0 ? 1 : t[Math.min(n, t.length) - 1]; }
function streakPow(n) { const t = CONFIG.streakPow; return n <= 0 ? 0 : t[Math.min(n, t.length) - 1]; }
/* 実際に消費する気合（非適性技は -1、最低0） */
function kiaiCost(f, act) { return Math.max(0, act.kiai - toothMod(f, act.cmd).save); }

/* 金蚉の宣告：カナブンがいて、宣言した行動・気合どおりに出したか（目押しがずれたら嘘扱い） */
function declaring(f) { return f.kanaU > 0 && !!f.decl; }
function honest(f, a) { return declaring(f) && a.cmd === f.decl.cmd && a.kiai === f.decl.kiai; }
function mashWeight(f) { return f.kanaG > 0 ? CONFIG.kanaMash : 1; }
/* 競り合いの決着（通信対戦と同じ決め方。引き分けはない）
   taps：各側がこのターンに送った連打数。①連打数（金蚉の加護の重みを掛けた値）→ ②投入した気合 → ③総戦闘力 → ④ランダム
   返り値 { winner: 0|1, by: 'mash'|'kiai'|'power'|'random', score: [重み付き連打数×2] } */
function mashWinner(st, acts, taps, rnd) {
  rnd = rnd || Math.random;
  const score = [0, 1].map(i => (taps[i] | 0) * mashWeight(st.f[i]));
  const pick = (a, b, by) => a !== b ? { winner: a > b ? 0 : 1, by, score } : null;
  const tp = [0, 1].map(i => totalPower(st.f[i].charId, st.f[i].up, st.f[i].down));
  return pick(score[0], score[1], 'mash') || pick(acts[0].kiai, acts[1].kiai, 'kiai') || pick(tp[0], tp[1], 'power')
    || { winner: rnd() < 0.5 ? 0 : 1, by: 'random', score };
}
function powerOf(st, i, acts) {
  const f = st.f[i], c = charOf(f), a = acts[i], oa = acts[1 - i];
  const parts = [];
  if (a.cmd === 'guard') parts.push(['ガード', c.guardPow]);
  else if (a.cmd === 'special') { parts.push(['必殺', SPECIALS[c.special].pow]); parts.push(['体格', c.basePow]); }
  else {
    const sk = skillOf(f, a.cmd);
    parts.push(['技', sk.pow]);
    parts.push(['体格', c.basePow]);
    if (c.trait && c.trait.sutemiDown && sk.type === 'down') parts.push(['捨て身', c.trait.sutemiDown.pow]);   // タカラ：下がり技は捨て身
    const tb = toothMod(f, a.cmd).pow;
    if (tb) parts.push(['内歯', tb]);
    const sp = streakPow(streakFor(f, a.cmd));
    if (sp) parts.push(['連続', sp]);   // 同じ技を続けると攻勢が落ちる
    if (sk.fx === 'readDown' && oa.cmd === 'down') parts.push(['先読み', sk.amt || 3]);   // 先読み崩し：相手の下がり技を読む
    if (sk.fx === 'readUp' && oa.cmd === 'up') parts.push(['見切り', sk.amt || 3]);       // 見切り投げ：相手の上がり技を読む
    if (sk.fx === 'lowKiai' && a.kiai <= 1) parts.push(['奇襲', 3]);
    if (sk.powKana && f.kanaG > 0) parts.push(['加護', sk.powKana - sk.pow]);   // 金蚉の加護：カナブンがいる間は攻勢が上がる
  }
  if (a.cmd !== 'guard' && f.buff && f.buff.pow) parts.push(['効果', f.buff.pow]);   // 前のターンに受けた攻勢の増減
  parts.push(['気合', a.kiai]);
  const total = parts.reduce((s, p) => s + p[1], 0);
  return { total, parts: parts.filter(p => p[1] !== 0 || p[0] === '気合') };
}

function chipRatio(sk, diff) {
  const tbl = sk && sk.fx === 'chip' ? CONFIG.chipSkill : CONFIG.chip;
  for (const r of tbl) if (diff <= r.maxDiff) return r.ratio;
  return 0;
}
/* 技のダメージ（適性倍率・連続使用減衰込み） */
function atkDamage(f, cmd, diff, opp, oa) {
  const sk = skillOf(f, cmd);
  let comeback = sk.fx === 'comeback' && opp && f.hp / f.maxHp < opp.hp / opp.maxHp ? (sk.mul || 1.5) : 1;
  if (sk.fx === 'grudge' && f.lostLast) comeback = sk.mul;
  const bm = f.buff && f.buff.dmgMul ? f.buff.dmgMul : 1;
  return Math.round(sk.dmg * charOf(f).atk * CONFIG.dmgScale * toothMod(f, cmd).dmg * streakMul(streakFor(f, cmd)) * comeback * bm
    * (1 + CONFIG.marginBonus * Math.min(diff, CONFIG.marginCap)));
}
/* 表示用：減衰なし・差0の基本威力 */
function baseDamage(f, cmd) { const sk = skillOf(f, cmd); return Math.round(sk.dmg * charOf(f).atk * CONFIG.dmgScale * toothMod(f, cmd).dmg); }
function specialDamage(f, kiai, opp) {
  const s = SPECIALS[charOf(f).special];
  let d = s.dmg * CONFIG.dmgScale * (1 + CONFIG.specialKiaiBonus * (kiai || 0));
  if (s.fx === 'honor' && opp && f.hp / f.maxHp < opp.hp / opp.maxHp) d *= s.mul;
  if (s.fx === 'execute' && opp && opp.hp / opp.maxHp <= s.th) d *= s.mul;
  if (s.fx === 'decay') d *= Math.max(s.floor, 1 - s.decay * (f.spHeld || 0));   // 魁：撃てる状態で待つほど威力が落ちる
  return d;
}

/* 判定前の分析：競り合いの有無 */
function analyze(st, acts) {
  const p = [powerOf(st, 0, acts), powerOf(st, 1, acts)];
  const res = { pow: [p[0].total, p[1].total], parts: [p[0].parts, p[1].parts], tie: false };
  const c0 = acts[0].cmd, c1 = acts[1].cmd;
  // 同値の競り合いは「通常技同士」「必殺同士」のみ（必殺 vs 通常技は必殺が必ず勝つ）
  const sameClass = (c0 === 'special') === (c1 === 'special');
  if (c0 !== 'guard' && c1 !== 'guard' && sameClass && res.pow[0] === res.pow[1]) res.tie = true;
  return res;
}

/* 純粋関数：結果の数値を返す（state は変更しない）
   ctx.tieWinner: 0|1|-1(引き分け) */
const bshort = f => { const c = charOf(f); return c.battleShort || c.short; };   // バトル中の略称（型・産地を出さない）
function outcome(st, acts, ctx) {
  const o = outcomeCore(st, acts, ctx), F = st.f;
  for (let i = 0; i < 2; i++) {
    if (!declaring(F[i])) continue;
    if (honest(F[i], acts[i])) {   // 宣言通り：与えるダメージが上がる
      const k = CONFIG.kanaDeclDmg;
      o.hits.forEach(h => { if (h.to === 1 - i) h.dmg = Math.round(h.dmg * k); });
      o.dmg[1 - i] = o.hits.filter(h => h.to === 1 - i).reduce((a, h) => a + h.dmg, 0);
      if (o.dmg[1 - i] > 0) { const t = `宣言通り ダメージ ×${k}`; o.fx.push({ to: i, text: t, bad: false }); o.notes.push(`${bshort(F[i])}：${t}`); }
      continue;
    }
    o.liar[i] = true;
    if (o.winner !== 1 - i || o.guardOk[1 - i]) continue;   // 罰は攻勢で負けた時だけ（ガードされただけなら効果継続）
    const k = CONFIG.kanaLieTaken;
    o.hits.forEach(h => { if (h.to === i) h.dmg = Math.round(h.dmg * k); });
    o.dmg[i] = o.hits.filter(h => h.to === i).reduce((a, h) => a + h.dmg, 0);
    o.kiaiLoss[i] += 1; o.kanaLeave[i] = true;
    { const t = `宣言破り 被ダメージ +${Math.round((k - 1) * 100)}%・気合 -1`; o.fx.push({ to: i, text: t, bad: true }); o.notes.push(`${bshort(F[i])}：${t}`); }
  }
  return o;
}
function outcomeCore(st, acts, ctx) {
  ctx = ctx || {};
  const an = analyze(st, acts);
  const o = {
    pow: an.pow, parts: an.parts, tie: an.tie,
    type: '', dmg: [0, 0], hit: [false, false], kiaiLoss: [0, 0], kiaiGain: [0, 0],
    regenPenalty: [0, 0], meterFast: [false, false], timeCut: [false, false], spLoss: [0, 0],
    heal: [0, 0], forceLock: [false, false], buffNext: [null, null], spAfterBonus: [0, 0], spGain: [0, 0], sealSp: [false, false], selfDmg: [0, 0],
    guardOk: [false, false], spZero: [false, false], sealCmd: [null, null], chipImmuneNext: [0, 0], kanaNext: [null, null], kanaLeave: [false, false], liar: [false, false], toothSealNext: [0, 0], guardStockGain: [0, 0], hits: [], notes: [], fx: [], winner: null, diff: Math.abs(an.pow[0] - an.pow[1]),
  };
  const F = st.f;
  // 効果の通知：画面のワイプ（o.fx）とログ（o.notes）の両方に載せる。文言は「項目 ±値」。bad＝受けた側に不利な効果
  const note = (side, text, bad) => { o.fx.push({ to: side, text, bad: !!bad }); o.notes.push(`${bshort(F[side])}：${text}`); };
  const addHit = (from, dmg, role, kind) => {
    const tb = F[1 - from].buff, tsk = skillOf(F[1 - from], acts[1 - from].cmd);
    const brace = tsk && tsk.fx === 'brace' ? (tsk.taken || 0.7) : 1;
    dmg = Math.max(0, Math.round(dmg * (tb && tb.takenMul ? tb.takenMul : 1) * brace));
    if (role === 'chip' && (F[1 - from].chipImmune > 0 || F[1 - from].kanaG > 0)) { if (dmg > 0) note(1 - from, '削りダメージ 無効'); dmg = 0; }
    o.dmg[1 - from] += dmg;
    o.hits.push({ from, to: 1 - from, dmg, role, kind });
  };
  const land = (i, cmd) => { // 命中時効果
    o.hit[i] = true;
    const j = 1 - i;
    if (cmd === 'special') {
      const sp = SPECIALS[charOf(F[i]).special];
      if (sp.drain) { o.kiaiLoss[j] += sp.drain; o.kiaiGain[i] += sp.drain; note(i, `気合 +${sp.drain}`); note(j, `気合 -${sp.drain}`, 1); }
      if (sp.spHalf) { const h = Math.floor(F[j].sp / 2); o.spLoss[j] += h; note(j, '必殺ゲージ 半減', 1); }
      switch (sp.fx) {
        case 'guardBreak': o.forceLock[j] = true; note(j, '次ターン ガード不可', 1); break;
        case 'heal': o.heal[i] += sp.heal; note(i, `HP +${sp.heal}`); break;
        case 'fortress': o.buffNext[i] = { takenMul: sp.taken, pow: 0 }; note(i, `次ターン 被ダメージ -${Math.round(Math.abs(1 - sp.taken) * 100)}%`); break;
        case 'shield': o.buffNext[i] = { takenMul: sp.taken, pow: 0, turns: sp.turns }; if (sp.heal) { o.heal[i] += sp.heal; note(i, `HP +${sp.heal}`); } note(i, `被ダメージ -${Math.round(Math.abs(1 - sp.taken) * 100)}%（${sp.turns}T）`); break;
        case 'tailwind': o.buffNext[i] = { takenMul: 1, pow: sp.powUp, turns: sp.turns || 1 }; note(i, sp.turns > 1 ? `攻勢 +${sp.powUp}（${sp.turns}T）` : `次ターン 攻勢 +${sp.powUp}`); break;
        case 'spSteal': o.spLoss[j] += sp.amt; o.spAfterBonus[i] += sp.amt; note(i, `必殺ゲージ +${sp.amt}%`); note(j, `必殺ゲージ -${sp.amt}%`, 1); break;
        case 'spWipe': o.spZero[j] = true; note(j, '必殺ゲージ 0%', 1); break;
        case 'drainHp': { const hv = Math.round(o.dmg[j] * sp.ratio); o.heal[i] += hv; note(i, `HP +${hv}`); break; }
        case 'comboNext': o.buffNext[i] = { takenMul: 1, pow: 0, dmgMul: sp.mul }; note(i, `次ターン 威力 ×${sp.mul}`); break;
        case 'sealCmd': {   // 得意技を封印。中央型（得意技なし）には最後に出した上がり/下がり技
          const tj = charOf(F[j]).tooth, aj = acts[j].cmd;
          const cmd = tj !== 'center' ? tj : (aj === 'up' || aj === 'down') ? aj : F[j].lastAtk;
          if (cmd) { o.sealCmd[j] = { cmd, n: sp.turns }; note(j, `${CMD_LABEL[cmd]} 封印（${sp.turns}T）`, 1); }
          break;
        }
        case 'sealSpecial': o.sealSp[j] = sp.turns || 1; note(j, `必殺 封印（${sp.turns || 1}T）`, 1); break;
        case 'pushback': o.buffNext[j] = { takenMul: 1, pow: -2 }; note(j, '次ターン 攻勢 -2', 1); break;
        case 'taboo': o.selfDmg[i] += sp.selfDmg; note(i, `HP -${sp.selfDmg}`, 1); break;
        case 'kiaiSelf': o.kiaiGain[i] += sp.kiai; note(i, `気合 +${sp.kiai}`); break;
        case 'regenBlock': o.regenPenalty[j] = 1; note(j, '次ターン 気合回復 -1', 1); break;
        case 'chipImmune': o.chipImmuneNext[i] = sp.turns; note(i, `削りダメージ 無効（${sp.turns}T）`); break;
        case 'kiaiSwap': o.kiaiLoss[j] += CONFIG.kiaiMax; o.kiaiGain[i] += CONFIG.kiaiMax; note(i, `気合 ${CONFIG.kiaiMax}`); note(j, '気合 0', 1); break;
        case 'toothSeal': if (charOf(F[j]).tooth !== 'center') { o.toothSealNext[j] = sp.turns; note(j, `得意・省エネ補正 無効（${sp.turns}T）`, 1); } else if (sp.centerPow) { o.buffNext[j] = { takenMul: 1, pow: sp.centerPow, turns: sp.turns }; note(j, `攻勢 ${sp.centerPow}（${sp.turns}T）`, 1); } break;   // 中央型には代わりに攻勢を下げる
      }
      return;
    }
    { const tr = charOf(F[i]).trait, sk0 = skillOf(F[i], cmd);   // キャラ固有の特性（通常技の命中時）
      if (tr && tr.absorbDown && sk0 && sk0.type === 'down') { o.spLoss[j] += tr.absorbDown; o.spGain[i] += tr.absorbDown; note(i, `必殺ゲージ +${tr.absorbDown}%`); note(j, `必殺ゲージ -${tr.absorbDown}%`, 1); }
      if (tr && tr.sutemiDown && sk0 && sk0.type === 'down') { o.selfDmg[i] += tr.sutemiDown.self; note(i, `HP -${tr.sutemiDown.self}`, 1); }
      if (tr && tr.sealHit && (acts[j].cmd === 'up' || acts[j].cmd === 'down') && !o.sealCmd[j]) { o.sealCmd[j] = { cmd: acts[j].cmd, n: tr.sealHit }; note(j, `${CMD_LABEL[acts[j].cmd]} 封印（${tr.sealHit}T）`, 1); } }
    const sk = skillOf(F[i], cmd);
    if (!sk || !sk.fx) return;
    if (sk.fx === 'kanaGuard' && F[i].kanaG > 0) { /* すでにいる：呼び直しても残りターンは延びない */ }
    else if (sk.fx === 'kanaDeclare' || sk.fx === 'kanaGuard') { o.kanaNext[i] = { kind: sk.fx === 'kanaDeclare' ? 'u' : 'g', turns: sk.turns }; note(i, `カナブン（${sk.turns}T）`); }
    if (sk.fx === 'pushHit') { o.buffNext[j] = { takenMul: 1, pow: -1 }; note(j, '次ターン 攻勢 -1', 1); }
    if (sk.fx === 'drain1') { const n = Math.max(0, (sk.amt || 1) - (streakFor(F[i], cmd) - 1)); if (n > 0) { o.kiaiLoss[j] += n; note(j, `気合 -${n}`, 1); } }   // 連続で使うほど削る量が減る（-2 → -1 → 0）
    if (sk.fx === 'healHit') { o.heal[i] += sk.heal; note(i, `HP +${sk.heal}`); }
    if (sk.fx === 'spBoost') { const n = sk.sp || 20; o.spGain[i] += n; note(i, `必殺ゲージ +${n}%`); }
    if (sk.fx === 'selfKiai') { o.kiaiGain[i] += 1; note(i, '気合 +1'); }
    if (sk.fx === 'spDrain') { o.spLoss[j] += CONFIG.spDrainAmt; note(j, `必殺ゲージ -${CONFIG.spDrainAmt}%`, 1); }
    if (sk.fx === 'regenBlock') { o.regenPenalty[j] = 1; note(j, '次ターン 気合回復 -1', 1); }
    if (sk.fx === 'meterFast') { o.meterFast[j] = true; note(j, '次ターン 目押し加速', 1); }
    if (sk.fx === 'timeCut') { o.timeCut[j] = true; note(j, `次ターン 選択時間 ${CONFIG.turnTimeShort}秒`, 1); }
  };
  const misfire = i => {   // 必殺が不発（ガードされた／必殺同士で打ち負けた）の時の固有効果。追加効果は出ず、ここに書いたものだけ発動
    const sp = SPECIALS[charOf(F[i]).special];
    if (sp.fx === 'spWipe') { o.spZero[1 - i] = true; note(1 - i, '必殺ゲージ 0%', 1); return; }
    if (sp.fx === 'spRefund') { if (sp.retryPow) { o.buffNext[i] = { takenMul: 1, pow: sp.retryPow }; note(i, `次ターン 攻勢 +${sp.retryPow}`); } o.spAfterBonus[i] += sp.refund; note(i, `必殺ゲージ ${Math.min(99, charOf(F[i]).sp.after + sp.refund)}%`); return; }
    if (sp.fx !== 'berserk') return;
    o.forceLock[i] = true; o.buffNext[i] = { takenMul: sp.recoilTaken, pow: 0 };
    note(i, `次ターン ガード不可・被ダメージ +${Math.round(Math.abs(1 - sp.recoilTaken) * 100)}%`, 1);
  };
  // 奈落落とし・守り崩し（命中とは無関係に発動）
  for (let i = 0; i < 2; i++) {
    const sk = skillOf(F[i], acts[i].cmd);
    if (sk && sk.fx === 'selfLock') o.forceLock[i] = true;   // 奈落落とし：使った次のターンはガード不可
    if (sk && sk.fx === 'guardKiai' && acts[1 - i].cmd === 'guard') { o.kiaiGain[i] += 2; note(i, '気合 +2'); }
  }

  const c = [acts[0].cmd, acts[1].cmd];
  if (c[0] === 'guard' && c[1] === 'guard') { o.type = 'standoff'; return o; }

  // ガード vs 攻撃
  for (let g = 0; g < 2; g++) {
    const a = 1 - g;
    if (c[g] !== 'guard') continue;
    if (c[a] === 'special' && SPECIALS[charOf(F[a]).special].fx === 'guardCrush') {   // 闘牛の猛進：ガードに合わせると大型並みの火力でガードを粉砕
      const spA = SPECIALS[charOf(F[a]).special];
      o.type = 'specialHit'; o.winner = a; o.crushed = true;
      addHit(a, specialDamage(F[a], acts[a].kiai, F[1 - a]) * spA.guardMul, 'main', 'special');
      note(1 - a, 'ガード 粉砕', 1);
      land(a, 'special');
      return o;
    }
    if (c[a] === 'special') {  // 必殺への唯一の対抗手段
      o.type = 'specialGuarded'; o.winner = g; o.guardOk[g] = true; o.kiaiGain[g] += CONFIG.guardRefund;
      const spA = SPECIALS[charOf(F[a]).special];
      addHit(a, specialDamage(F[a], acts[a].kiai, F[1 - a]) * (spA.guardRatio != null ? spA.guardRatio : CONFIG.specialGuardRatio), 'main', 'special');
      misfire(a);
      return o;
    }
    const skA = skillOf(F[a], c[a]);
    if (skA && skA.guardPush) { o.buffNext[g] = { takenMul: 1, pow: -skA.guardPush }; note(g, `次ターン 攻勢 -${skA.guardPush}`, 1); }   // 押し上げ返し：ガードされた時だけ押し返す
    if (skA && skA.fx === 'guardPierce') {   // 穿ち上げ：ガードの成否に関係なく貫く
      o.type = 'guardThrough'; o.pierced = true; o.winner = a;
      addHit(a, F[g].maxHp * skA.piercePct, 'main', c[a]);
      land(a, c[a]);
      return o;
    }
    { const trP = charOf(F[a]).trait;   // チュウゴク：封印中の相手のガードは、通常より多く通る
      if (trP && trP.sealPierce && F[g].cmdSeal && F[g].cmdSeal.n > 0) { o.type = 'guardThrough'; o.winner = a; note(g, 'ガード 貫通', 1); addHit(a, atkDamage(F[a], c[a], 0, F[1 - a], acts[1 - a]) * trP.sealPierce, 'main', c[a]); land(a, c[a]); return o; } }
    if (an.pow[g] >= an.pow[a]) {
      o.type = 'guardOk'; o.winner = g; o.guardOk[g] = true; o.kiaiGain[g] += CONFIG.guardRefund;
      const trA = charOf(F[a]).trait;   // 剛圧：完全に受け止められても削る
      if (trA && trA.guardChip) addHit(a, atkDamage(F[a], c[a], 0, F[1 - a], acts[1 - a]) * trA.guardChip, 'chip', c[a]);
    } else {
      o.type = 'guardThrough'; o.winner = a;
      const trA = charOf(F[a]).trait;
      addHit(a, atkDamage(F[a], c[a], 0, F[1 - a], acts[1 - a]) * (trA && trA.guardPierce ? trA.guardPierce : CONFIG.guardReduce), 'main', c[a]);
      land(a, c[a]);
    }
    return o;
  }

  // 必殺 vs 通常技：必殺が必ず打ち勝つ
  for (let i = 0; i < 2; i++) {
    if (c[i] === 'special' && c[1 - i] !== 'special') {
      o.type = 'specialHit'; o.winner = i;
      addHit(i, specialDamage(F[i], acts[i].kiai, F[1 - i]), 'main', 'special');
      land(i, 'special');
      return o;
    }
  }

  // 通常技同士 / 必殺同士
  let w;
  const diff = o.diff;
  if (an.tie) {
    const tw = ctx.tieWinner == null ? -1 : ctx.tieWinner;
    if (tw === -1) {
      o.type = 'mashDraw';
      for (let i = 0; i < 2; i++) {
        if (c[i] === 'special') addHit(i, specialDamage(F[i], acts[i].kiai, F[1 - i]) * CONFIG.mashDrawRatio, 'main', 'special');
        else addHit(i, atkDamage(F[i], c[i], 0, F[1 - i], acts[1 - i]) * CONFIG.mashDrawRatio, 'main', c[i]);
      }
      return o;
    }
    w = tw; o.type = 'mash';
  } else {
    w = an.pow[0] > an.pow[1] ? 0 : 1;
    o.type = 'win';
  }
  const l = 1 - w;
  o.winner = w;
  if (c[w] === 'special') {
    if (!an.tie) o.type = 'specialHit';
    addHit(w, specialDamage(F[w], acts[w].kiai, F[1 - w]), 'main', 'special');
    land(w, 'special');
    if (c[l] === 'special') { o.notes.push('必殺同士の激突！'); misfire(l); }
    return o;
  }
  addHit(w, atkDamage(F[w], c[w], diff, F[1 - w], acts[1 - w]), 'main', c[w]);
  land(w, c[w]);
  if (!an.tie) {
    const tr = charOf(F[l]).trait;
    let r = chipRatio(skillOf(F[l], c[l]), diff);
    if (tr && tr.chip) for (const t of tr.chip) if (diff <= t.maxDiff) { r = Math.max(r, t.ratio); break; }
    if (r > 0) addHit(l, atkDamage(F[l], c[l], 0, F[1 - l], acts[1 - l]) * r, 'chip', c[l]);
  }
  return o;
}

/* 結果を state に適用し、新しい state を返す */
function applyOutcome(st, acts, o) {
  const ns = cloneState(st);
  for (let i = 0; i < 2; i++) {   // 必殺MAX時の振る舞いを記録（ゲージ・ガード可否は公開情報）
    const f = ns.f[i], j = 1 - i;
    if (specialReady(st.f[i])) {
      f.spHeld = acts[i].cmd === 'special' ? 0 : f.spHeld + 1;
      if (!st.f[j].guardLocked) { f.guardObs.n++; if (acts[j].cmd === 'guard') f.guardObs.g++; }
    } else f.spHeld = 0;
  }
  for (let i = 0; i < 2; i++) {
    const f = ns.f[i], c = charOf(f), a = acts[i];
    f.kiai = clamp(f.kiai - kiaiCost(f, a) - o.kiaiLoss[i] + o.kiaiGain[i], 0, CONFIG.kiaiMax);
    f.hp = Math.max(0, f.hp - o.dmg[i]);
    if (f.hp > 0 && o.heal[i]) f.hp = Math.min(f.maxHp, f.hp + o.heal[i]);
    if (f.hp > 0 && o.selfDmg[i]) f.hp = Math.max(1, f.hp - o.selfDmg[i]);   // 反動では倒れない
    f.spSealed = o.sealSp[i] ? +o.sealSp[i] : Math.max(0, (f.spSealed | 0) - 1);   // 必殺封印の残りターン
    f.cmdSeal = o.sealCmd[i] ? { ...o.sealCmd[i] } : f.cmdSeal && f.cmdSeal.n > 1 ? { cmd: f.cmdSeal.cmd, n: f.cmdSeal.n - 1 } : null;   // 技封印の残りターン
    if (a.cmd === 'up' || a.cmd === 'down') f.lastAtk = a.cmd;
    f.stats.dealt += o.dmg[1 - i];
    // 必殺ゲージ
    if (a.cmd === 'special') { f.sp = Math.min(CONFIG.specialMax - 1, c.sp.after + o.spAfterBonus[i]); f.stats.specials++; }
    else {
      let g = c.sp.perTurn;
      if (o.dmg[1 - i] > 0) g += c.sp.hit;
      if (o.dmg[i] > 0) g += c.sp.hurt;
      if (o.guardOk[i]) g += c.sp.guard;
      g += o.spGain[i];
      f.sp = clamp(f.sp + (st.f[i].spSealed ? 0 : g) - o.spLoss[i], 0, CONFIG.specialMax);   // 封印中は必殺ゲージが溜まらない
    }
    if (o.spZero[i]) f.sp = 0;
    // カナブン：呼んだターンの次から数える。宣言を破って負けたら去る
    const kn = o.kanaNext[i];
    f.kanaU = o.kanaLeave[i] ? 0 : kn && kn.kind === 'u' ? kn.turns : Math.max(0, (f.kanaU || 0) - 1);
    f.kanaG = kn && kn.kind === 'g' ? kn.turns : Math.max(0, (f.kanaG || 0) - 1);
    if (declaring(st.f[i])) { f.declObs = { n: f.declObs.n + 1, h: f.declObs.h + (o.liar[i] ? 0 : 1) }; }
    f.decl = null;   // 原初の王者：必殺を撃った直後でも 0 にする
    if (a.cmd === 'guard' && st.f[i].guardLocked) f.guardStock = Math.max(0, f.guardStock - 1);   // 権利を使ってガードした
    if (a.cmd === 'special' && o.hit[i] && SPECIALS[c.special].fx === 'guardStock') f.guardStock = 1;   // 海神の重圧：命中時に権利を得る（最大1つまで）
    f.guardLocked = a.cmd === 'guard' || o.forceLock[i];
    f.lockSelf = a.cmd === 'guard' && !o.forceLock[i];
    f.chipImmune = o.chipImmuneNext[i] || Math.max(0, (f.chipImmune || 0) - 1);
    f.toothSeal = o.toothSealNext[i] || Math.max(0, (f.toothSeal || 0) - 1);
    // 次ターン補正：新しい効果があれば上書き、なければ継続ターンを1減らす
    f.buff = o.buffNext[i] || (f.buff && f.buff.turns > 1 ? { ...f.buff, turns: f.buff.turns - 1 } : { takenMul: 1, pow: 0 });
    // 連続使用カウント：違うコマンド（反対側の技・ガード・必殺）を挟むとリセット
    f.lostLast = o.winner === 1 - i && !o.guardOk[1 - i];   // 恨み返し用：このターン相手に負けた（ガードで受け止められただけなら数えない）
    {   // 行動の記録（CPU が相手の癖を読むのに使う）
      const h = f.hist || (f.hist = { n: 0, cmd: {}, after: {}, kf: {} }), prev = st.f[i].lastCmd || 'start';
      h.n++; h.cmd[a.cmd] = (h.cmd[a.cmd] || 0) + 1;
      const t = h.after[prev] || (h.after[prev] = {}); t[a.cmd] = (t[a.cmd] || 0) + 1;
      const kf = h.kf[a.cmd] || (h.kf[a.cmd] = { n: 0, s: 0 }); kf.n++; kf.s += st.f[i].kiai > 0 ? a.kiai / st.f[i].kiai : 0;
    }
    f.streak = streakFor(f, a.cmd);
    f.lastCmd = a.cmd;
  }
  // 勝敗
  const ko = [ns.f[0].hp <= 0, ns.f[1].hp <= 0];
  if (ko[0] || ko[1]) {
    ns.over = true;
    if (ko[0] && ko[1]) ns.winner = o.dmg[1] > o.dmg[0] ? 0 : o.dmg[0] > o.dmg[1] ? 1 : -1;
    else ns.winner = ko[0] ? 1 : 0;
    return ns;
  }
  // 自然回復 & 次ターンの妨害
  for (let i = 0; i < 2; i++) {
    const f = ns.f[i];
    f.kiai = clamp(f.kiai + Math.max(1, regenOf(st.f[i]) - o.regenPenalty[i]), 0, CONFIG.kiaiMax);   // カナブンの加護は、このターン開始時にいたかで決める   // 自然回復は、どの効果を受けても最低1は残る（回復0での詰みを防ぐ）
    f.debuff = { meterFast: o.meterFast[i], timeCut: o.timeCut[i] };
  }
  // ターン上限：最後のターンを終えても決着していなければ、HP の割合が高い側の勝ち（同じなら引き分け）
  if (ns.turn >= CONFIG.maxTurns) {
    ns.over = true; ns.timeUp = true;
    const a = ns.f[0].hp * ns.f[1].maxHp, b = ns.f[1].hp * ns.f[0].maxHp;   // 割合を整数の掛け算で比べる（小数の誤差を出さない）
    ns.winner = a > b ? 0 : b > a ? 1 : -1;
    return ns;
  }
  ns.turn++;
  return ns;
}

/* ================= CPU =================
   公開情報のみで判断（プレイヤーの今ターン入力は参照しない） */
function gauss(x, mu, s) { return Math.exp(-((x - mu) * (x - mu)) / (2 * s * s)); }

function opponentModel(st, i) {
  const me = st.f[i], op = st.f[1 - i], oc = charOf(op), A = CONFIG.ai;
  const list = [];
  const cmds = allowedCmds(op);
  const cw = { up: 1, down: 1, guard: 0.75, special: 1.6 };
  if (oc.tooth === 'up') cw.up = 1.3;
  if (oc.tooth === 'down') cw.down = 1.3;
  if (op.lastCmd === 'up' || op.lastCmd === 'down') {           // 連続使用が進むほど同じ技は出しにくい
    cw[op.lastCmd] *= [1, 1, 0.9, 0.55, 0.35][Math.min(op.streak, 4)];
  }
  if (specialReady(me)) {                                         // こちらの必殺を警戒してガードするか：実際の振る舞いから学習
    const ob = me.guardObs || { n: 0, g: 0 };
    const rate = (ob.g + A.guardPrior) / (ob.n + 1);              // 観察0回なら事前確率 guardPrior
    cw.guard = 0.5 + 2.4 * rate;
  }
  if (!allowedCmds(me).includes('guard')) cw.special = 3.2;                          // こちらがガード不可なら必殺が来やすい
  // 相手の癖：上がり技／下がり技／ガードの出し方（全体の割合と「直前の行動の次に何を出したか」）を、事前の読みに掛ける。
  // 必殺や、こちらの必殺を警戒したガードなど、その場の状況で決まる読みは崩さない（倍率として掛けるだけ）
  const H = op.hist, B = cmds.filter(c => c !== 'special');
  if (H && H.n > 0 && B.length > 1) {
    const b0 = { up: oc.tooth === 'up' ? 1.3 : 1, down: oc.tooth === 'down' ? 1.3 : 1, guard: 0.75 };
    let bt = 0; for (const c of B) bt += b0[c];
    const tr = H.after[op.lastCmd || 'start'] || {}; let tn = 0, hn = 0;
    for (const c of B) { tn += tr[c] || 0; hn += H.cmd[c] || 0; }
    for (const c of B) {
      const prior = b0[c] / bt;
      const all = (prior * A.histPrior + (H.cmd[c] || 0)) / (A.histPrior + hn);          // 全体の傾向
      const q = (all * A.transPrior + (tr[c] || 0)) / (A.transPrior + tn);               // 直前の行動からの流れ
      cw[c] *= clamp(q / prior, 0.4, 2.5);
    }
  }
  const kmu = cmd => {   // 気合の入れ具合も、その行動での実績に寄せる
    const base = cmd === 'special' || cmd === 'guard' ? 0.3 : A.oppKiaiMu, r = H && H.kf[cmd];
    return op.kiai * (r ? (base * A.kiaiPrior + r.s) / (A.kiaiPrior + r.n) : base);
  };
  let tot = 0;
  for (const cmd of cmds) {
    const mu = kmu(cmd);
    for (let k = 0; k <= op.kiai; k++) {
      const w = cw[cmd] * gauss(k, mu, A.oppKiaiSigma);
      list.push({ cmd, kiai: k, w }); tot += w;
    }
  }
  list.forEach(e => e.w /= tot);
  if (declaring(op)) {   // 相手の宣言：これまで守った割合だけ信じる
    const ob = op.declObs, b = clamp((ob.h + A.declTrust * 2) / (ob.n + 2), 0.15, 0.95);
    list.forEach(e => e.w *= 1 - b);
    const d = list.find(e => e.cmd === op.decl.cmd && e.kiai === op.decl.kiai);
    if (d) d.w += b; else list.push({ cmd: op.decl.cmd, kiai: op.decl.kiai, w: b });
  }
  return list.filter(e => e.w > 0.002);
}

function evalOne(st, i, o, myAct) {
  const A = CONFIG.ai, me = st.f[i], op = st.f[1 - i], j = 1 - i;
  const dealt = o.dmg[j], taken = o.dmg[i];
  let u = dealt - taken * A.defW;
  if (dealt >= op.hp) u += A.killBonus;
  if (taken >= me.hp) u -= A.killBonus;
  const myK = clamp(me.kiai - kiaiCost(me, myAct) - o.kiaiLoss[i] + o.kiaiGain[i], 0, CONFIG.kiaiMax);
  const myNext = Math.min(CONFIG.kiaiMax, myK + Math.max(1, regenOf(me) - o.regenPenalty[i]));
  const opK = clamp(op.kiai - o.kiaiLoss[j] + o.kiaiGain[j], 0, CONFIG.kiaiMax);
  u += A.kiaiValue * myNext - A.kiaiValue * 0.6 * (op.kiai - opK);
  if (o.meterFast[j] || o.timeCut[j]) u += 1.2;
  if (o.regenPenalty[j]) u += A.kiaiValue * 0.8;
  if (o.spLoss[j]) u += o.spLoss[j] * 0.12;
  u += o.heal[i] * 0.8 - o.heal[j] * 0.8;
  if (o.forceLock[j]) u += 5; if (o.forceLock[i]) u -= 5;
  const bf = b => b ? ((1 - b.takenMul) * 18 + b.pow * 2) * (b.turns || 1) : 0;
  u += bf(o.buffNext[i]) - bf(o.buffNext[j]);
  u += o.spAfterBonus[i] * 0.15 + o.spGain[i] * 0.12 - o.selfDmg[i] + (o.sealSp[j] ? 4 : 0) + (o.sealCmd[j] ? 4 : 0);
  return u;
}

function expectedUtility(st, i, myAct, model) {
  let U = 0;
  const me = st.f[i], c = charOf(me);
  const holdVal = specialReady(me) ? specialDamage(me, 0) : 0;
  // 温存し続けるほど「撃てる状態」の価値と、ガードを誘う価値は下がる（いつまでも撃たない状態を防ぐ）
  const holdDecay = Math.max(0, 1 - CONFIG.ai.holdDecay * (me.spHeld || 0));
  if (holdVal && myAct.cmd !== 'special') U += holdVal * CONFIG.ai.holdValue * holdDecay;  // 「撃てる状態」自体の価値
  // 温存型の必殺（魁）：相手がガードできる間は、ガードを誘って次のターンに撃つ価値を見込む（次のターンの威力で）
  const op = st.f[1 - i], spc = SPECIALS[c.special];
  let baitVal = holdVal;
  if (holdVal && spc.aiHold && allowedCmds(op).includes('guard')) {
    const nd = specialDamage({ ...me, spHeld: (me.spHeld || 0) + 1 }, me.kiai, op);
    baitVal = nd + (nd >= op.hp ? CONFIG.ai.killBonus : 0);
    if (myAct.cmd !== 'special') U += baitVal * CONFIG.ai.killHold * holdDecay;
  }
  for (const e of model) {
    const acts = [];
    acts[i] = myAct; acts[1 - i] = { cmd: e.cmd, kiai: e.kiai };
    const base = outcome(st, acts, { tieWinner: i });
    const pw = mashWeight(me) / (mashWeight(me) + mashWeight(st.f[1 - i]));   // 競り合いの勝ちやすさ（カナブンの加護）
    let u = base.tie
      ? pw * evalOne(st, i, base, myAct) + (1 - pw) * evalOne(st, i, outcome(st, acts, { tieWinner: 1 - i }), myAct)
      : evalOne(st, i, base, myAct);
    // 必殺を温存したまま相手にガードを吐かせたら、次ターンは相手がガード不可＝必殺の好機
    if (holdVal && myAct.cmd !== 'special' && e.cmd === 'guard') u += baitVal * CONFIG.ai.baitValue * holdDecay;
    U += e.w * u;
  }
  if (myAct.cmd === 'guard') U -= CONFIG.ai.guardLockCost;
  if (myAct.cmd === 'special') U -= CONFIG.ai.specialCost * (1 - c.sp.after / CONFIG.specialMax);
  // 連続使用が進んだ技は次ターン以降の火力も落ちる
  const n = streakFor(me, myAct.cmd);
  if (n >= 3) U -= (n - 2) * 1.5;
  return U;
}

function cpuDecide(st, i, opts) {
  opts = opts || {};
  const rnd = opts.rng || Math.random;
  let T = opts.temp != null ? opts.temp : CONFIG.ai.temp.normal;
  const me = st.f[i];
  if (me.debuff.timeCut) T *= 1.8;          // 焦らされると判断が雑になる
  const model = opponentModel(st, i);
  const cands = [];
  for (const cmd of allowedCmds(me)) for (let k = 0; k <= me.kiai; k++) {
    const act = { cmd, kiai: k };
    if (opts.bluff && honest(me, act)) continue;   // はったり：宣言とわざと違う行動を取る
    cands.push({ act, u: expectedUtility(st, i, act, model) });
  }
  const mx = Math.max(...cands.map(c => c.u));
  let tot = 0;
  cands.forEach(c => { c.p = Math.exp((c.u - mx) / T); tot += c.p; });
  let r = rnd() * tot, pick = cands[0];
  for (const c of cands) { r -= c.p; if (r <= 0) { pick = c; break; } }
  const act = { ...pick.act };
  if (me.debuff.meterFast && rnd() < 0.5) act.kiai = clamp(act.kiai + (rnd() < 0.5 ? -1 : 1), 0, me.kiai); // 目押しミス
  return act;
}

/* 金蚉の宣告：CPU の宣言（宣言なしで一番良い手を、そのまま宣言する） */
function cpuDeclare(st, i, opts) {
  const s2 = cloneState(st); s2.f[i].decl = null; s2.f[i].debuff.meterFast = false;
  return cpuDecide(s2, i, opts);
}
/* 時間切れ：その時点で選べる技からランダム。気合も 0〜残量 からランダム */
function timeoutAct(f, rnd) {
  rnd = rnd || Math.random;
  const cmds = allowedCmds(f);
  return { cmd: cmds[Math.floor(rnd() * cmds.length)], kiai: Math.floor(rnd() * (f.kiai + 1)) };
}
function cpuLoadout(charId, rnd) {
  rnd = rnd || Math.random;
  const p = CHARS[charId].pool;
  return { up: p.up[Math.floor(rnd() * p.up.length)], down: p.down[Math.floor(rnd() * p.down.length)] };
}

const api = { CONFIG, CHARS, SKILLS, SPECIALS, RANKS, STYPES, CMD_LABEL, deriveAll, hpBonus, spFull, regenOf, totalPower, makeFighter, newBattle, allowedCmds, specialReady,
  analyze, outcome, applyOutcome, cpuDecide, cpuLoadout, powerOf, charOf, skillOf, toothBonus, fitOf, toothMod,
  streakFor, streakMul, streakPow, kiaiCost, baseDamage, specialDamage, clamp, cpuDeclare, honest, declaring, mashWeight, mashWinner, timeoutAct,
  opponentModel, expectedUtility, evalOne };   // 後ろの3つは CPU 思考の途中経過（移植の照合用）
root.KDT = api;
if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
