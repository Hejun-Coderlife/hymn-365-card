/* 顶栏光轨（2026-09-20）。
   搬自访客登记系统 TIESTON 的 `visitorHeaderFx`（~/Desktop 那个项目，也在 GitHub
   Hejun-Coderlife/visitor-system），**算法一行没改**，只换了两处颜色：
     底色    深靛蓝 [0.055,0.043,0.129]  →  深梅黑 [0.094,0.055,0.067]
     光轨    冷蓝青 + 暖金               →  品牌粉 #EDACB2 + 暖金

   800 条光轨从左往右扫，一次 drawArrays 画完，CPU 每帧只更新一个 uTime；
   0.6x 分辨率 + 30fps 上限；切到后台停渲染；WebGL 拿不到就静默退化成纯色底
   （所以容器自己要有 background，别指望 canvas 兜底）。
   `prefers-reduced-motion` 下只画一帧就停。

   用法：<div class="hdrfx"> 里放 logo 和标题，然后 hymnHeaderFx(那个div)。
   canvas 会被插成第一个子节点，绝对定位铺满，所以容器要 position:relative，
   里面的内容要 position:relative;z-index:1，否则会被光轨盖住。 */
/* fx.js —— 两处光效
   visitorFx()        页面背景：竖向光丝上行 + 光谱色（浅底，常规混合）
   visitorHeaderFx()  冻结标题栏：深色底 + 曲线光轨扫掠（加色混合，才有辉光）
   都是一次 drawArrays 画完，CPU 每帧只更新一个 uTime。
   0.6x 分辨率 + 30fps 上限；切到后台停渲染；WebGL 不可用时静默退化。 */
(function (global) {

  function build(mount, o) {
    var N = o.count, cv = document.createElement('canvas');
    cv.className = o.cls;
    if (mount === document.body) mount.insertBefore(cv, mount.firstChild);
    else mount.insertBefore(cv, mount.firstChild);
    var gl = null;
    try {
      gl = cv.getContext('webgl', { alpha: !!o.alphaCanvas, antialias: false, premultipliedAlpha: false })
        || cv.getContext('experimental-webgl');
    } catch (e) {}
    if (!gl) return '拿不到 WebGL 上下文';

    function sh(t, src) {
      var s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
      return s;
    }
    var vs = sh(gl.VERTEX_SHADER, o.vs), fs = sh(gl.FRAGMENT_SHADER, o.fs);
    if (!vs || !fs) return 'shader 编译失败（详见控制台）';
    var pr = gl.createProgram();
    gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(pr)); return 'program 链接失败'; }
    gl.useProgram(pr);

    var data = new Float32Array(N * 18), q = [[0,-1],[0,1],[1,-1],[1,-1],[0,1],[1,1]], k = 0;
    for (var i = 0; i < N; i++) for (var j = 0; j < 6; j++) { data[k++] = i; data[k++] = q[j][0]; data[k++] = q[j][1]; }
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    ['aIdx','aT','aSide'].forEach(function (nm, n) {
      var loc = gl.getAttribLocation(pr, nm);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 1, gl.FLOAT, false, 12, n * 4);
    });
    var uTime = gl.getUniformLocation(pr, 'uTime');
    var uAspect = gl.getUniformLocation(pr, 'uAspect');
    gl.uniform1f(gl.getUniformLocation(pr, 'uCount'), N);
    gl.uniform1f(gl.getUniformLocation(pr, 'uAlpha'), o.alpha);
    gl.enable(gl.BLEND);
    // 浅底用常规混合（加色会糊成白）；深底用加色混合（光叠加才亮）
    if (o.blend === 'add') gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    function size() {
      var w = o.box ? mount.clientWidth : innerWidth;
      var h = o.box ? mount.clientHeight : innerHeight;
      var d = Math.min(window.devicePixelRatio || 1, 1.6) * 0.6;
      cv.width = Math.max(1, Math.round(w * d));
      cv.height = Math.max(1, Math.round(h * d));
      gl.viewport(0, 0, cv.width, cv.height);
      gl.uniform1f(uAspect, cv.width / Math.max(cv.height, 1));
    }
    size();
    var rt; addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(size, 200); });

    function draw(t) {
      gl.clearColor(o.bg[0], o.bg[1], o.bg[2], o.bg[3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uTime, t);
      gl.drawArrays(gl.TRIANGLES, 0, N * 6);
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { draw(0); return '系统开了「减弱动态效果」，只画一帧'; }
    var last = 0, t0 = performance.now(), hid = false;
    document.addEventListener('visibilitychange', function () { hid = document.hidden; });
    (function loop(now) {
      requestAnimationFrame(loop);
      if (hid || now - last < 33) return;
      last = now;
      draw((now - t0) / 1000);
    })(performance.now());
    return '';   // 空字符串 = 一切正常
  }

  /* ---------- 标题栏：深色底 + 曲线光轨扫掠 ---------- */
  global.hymnHeaderFx = function (el, opt) {
    /* 返回值：'' = 正常在跑；非空字符串 = 失败原因。
       【教训】2026-09-20 第一次接进来时，插 <script> 的字符串没算上 ?v= 版本戳，
       替换静默失败 —— 页面上只剩 CSS 画的深色条，用户问「流光的效果呢」。
       所以这里一律给出可打印的失败原因，调用方自己决定怎么报。 */
    if (!el) return '容器元素不存在';
    opt = opt || {};
    return build(el, {
      cls: 'fx-hd', count: opt.count || 800, alpha: opt.alpha == null ? 1 : opt.alpha,
      bg: [0.929, 0.675, 0.698, 1], blend: 'add', box: true,
      vs: [
        'precision highp float;',
        'attribute float aIdx,aT,aSide;',
        'uniform float uTime,uCount,uAspect;',
        'varying float vT,vSeed,vSide,vFade;',
        'float hash(float n){return fract(sin(n)*43758.5453);}',
        'void main(){',
        '  vT=aT; vSeed=aIdx/uCount; vSide=aSide;',
        '  float h=hash(aIdx);',
        // 从左侧射出，向右扫掠；轨迹带弧度，越靠中线越密（透视收束感）
        '  float lane=(hash(aIdx+3.0)*2.0-1.0)*1.06;',
        '  float bow=lane*(1.0-abs(lane))*1.35;',      // 中间弯得多，边缘平直
        '  float sp=0.55+h*1.35;',
        '  float ph=fract(uTime*0.16*sp+hash(aIdx+17.0));',
        '  float x0=-1.35+ph*2.9;',
        '  float len=0.22+0.85*hash(aIdx+23.0);',
        '  float x1=x0+len;',
        '  float y0=lane*0.92+sin(x0*1.7+uTime*0.35)*0.10*bow;',
        '  float y1=lane*0.92+sin(x1*1.7+uTime*0.35)*0.10*bow;',
        '  vec2 q0=vec2(x0,y0), q1=vec2(x1,y1);',
        '  vec2 df=q1-q0; vec2 tg=df/max(length(df),1e-5);',
        '  vec2 pe=vec2(-tg.y,tg.x);',
        '  float w=0.0026+0.0048*h;',
        '  gl_Position=vec4(mix(q0,q1,aT)+pe*aSide*w, 0.0, 1.0);',
        '  vFade=smoothstep(1.55,0.30,abs(x0));',
        '}'
      ].join('\n'),
      fs: [
        'precision mediump float;',
        'varying float vT,vSeed,vSide,vFade;',
        'uniform float uAlpha;',
        'void main(){',
        '  float edge=1.0-abs(vSide);',
        '  edge=pow(edge,0.7);',
        '  float a=edge*vFade*(0.06+0.94*vT)*0.13*uAlpha;',   // 浅底上加色很快就糊成白，比深底那版压了一半   // 浅底上加色很快就糊成白，比深底那版压了一半
        // 【改法说明】第一版做成「深梅黑底 + 粉金光轨」，用户说「像咖啡色，不像赫眉品牌色」。
        // 病根是方向错了：赫眉自己的呈现方式就是**粉底白字**（品牌 logo 原件
        // #EDACB2 占 90.5%、字是白的），不是深色科技风。暖金一掺更往咖啡里走。
        // 所以底色直接用品牌粉，光轨改成白 → 粉白，**金全部去掉**。
        // 【配色定版，2026-09-20】品牌粉底 #EDACB2 + 白色光轨，加色混合。
        //
        // 紫粉/霓虹那条路试过四版，全部放弃，用户最后的判断是「太暗了，改回原来的赫眉色+白色」。
        // 失败记录留着，别再走一遍：
        //   v1 深褐黑底 + 粉金光轨        → 「像咖啡色」（暖褐 + 金 = 咖啡）
        //   v2 品牌粉底 + 白光轨          → 「太粉太白」← **就是现在这版，最后选定的**
        //   v3 品牌粉底 + 紫光轨(正常混合) → 「还是不好看」（800 条半透明互相覆盖，糊成一块均匀桃红）
        //   v4 深紫黑底 + 纯紫粉霓虹       → 「太暗了」
        // 结论：霓虹要暗底才成立，而这块看板要的是品牌的粉底白字，两者不兼容。**别再试紫了。**
        '  vec3 c=mix(vec3(1.0,1.0,1.0),vec3(1.0,0.945,0.957),fract(vSeed*3.7));',
        '  gl_FragColor=vec4(c,a);',
        '}'
      ].join('\n'),
    });
  };

  /* ---------- 背景：竖向光丝，从下往上流（2026-09-20 搬自访客登记系统的 visitorFx）----------
     算法原样没动，只换了底色和三档光丝颜色（蓝/紫/桃红 → 赫眉粉系）。
     460 条细丝从屏幕下方往上飘，一次 drawArrays 画完，30fps 上限、0.6x 分辨率。
     白底用的是**正常混合**：加色混合在白底上等于没画，这点跟顶栏那条（深底加色）正相反。
     canvas 铺满视口、z-index:0，页面内容要在它上面就得有自己的层叠上下文。 */
  /* ---------- 背景：竖向光丝（保持原样） ---------- */
  global.hymnBgFx = function (opt) {
    opt = opt || {};
    build(document.body, {
      cls: 'fx-bg', count: opt.count || 460, alpha: opt.alpha == null ? 1 : opt.alpha,
      // 底色可传：画布底色必须跟页面底色一模一样，差 2~3 阶在屏幕上
      // 就是一块看得出来的色块。默认纯白。
      bg: opt.bg || [1.0, 1.0, 1.0, 1], blend: 'normal', box: false,
      vs: [
        'precision highp float;',
        'attribute float aIdx,aT,aSide;',
        'uniform float uTime,uCount,uAspect;',
        'varying float vT,vSeed,vSide;',
        'float hash(float n){return fract(sin(n)*43758.5453);}',
        'void main(){',
        '  vT=aT; vSeed=aIdx/uCount; vSide=aSide;',
        '  float h=hash(aIdx);',
        '  float x=(h*2.0-1.0)*1.15;',
        '  float sp=0.45+hash(aIdx+5.0)*1.1;',
        '  float ph=fract(uTime*0.14*sp+hash(aIdx+29.0));',
        '  float y0=-1.45+ph*2.9;',
        '  float len=0.14+0.40*hash(aIdx+11.0);',
        '  float w=0.0013+0.0022*h;',
        '  float bend=sin(uTime*0.25+aIdx*0.7)*0.018;',
        '  gl_Position=vec4(x+bend+aSide*w, mix(y0,y0+len,aT), 0.0, 1.0);',
        '}'
      ].join('\n'),
      fs: [
        'precision mediump float;',
        'varying float vT,vSeed,vSide;',
        'uniform float uAlpha;',
        'void main(){',
        '  float edge=1.0-abs(vSide);',
        '  float a=edge*(0.15+0.85*vT)*0.17*uAlpha;',
        // 赫眉色系三档：品牌粉 #EDACB2 → 玫红 #D9668A → 深玫 #C25E77。
        // 白底上用**正常混合**，所以这些色要比底色深才看得见（加色在白底上等于没画）。
        '  vec3 c1=vec3(0.929,0.675,0.698);',
        '  vec3 c2=vec3(0.851,0.400,0.541);',
        '  vec3 c3=vec3(0.761,0.369,0.467);',
        '  vec3 c=vSeed<0.5?mix(c1,c2,vSeed*2.0):mix(c2,c3,(vSeed-0.5)*2.0);',
        '  gl_FragColor=vec4(c,a);',
        '}'
      ].join('\n'),
    });
  };

})(window);
