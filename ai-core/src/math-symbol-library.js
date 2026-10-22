// Shared, inert insertion catalog. Values are text/LaTeX only; nothing is evaluated.
export const MATH_SYMBOL_GROUPS = [
  {
    id: "popular", label: "Thường dùng", items: [
      // The one formula template that belongs in this group: a slash in a table
      // cell stays plain text, so this is how a real fraction reaches a cell.
      ["Phân số (chia phần)", "a⁄b", "\\frac{a}{b}", "formula"],
      ["Nhân", "×", "\\times"], ["Chia", "÷", "\\div"], ["Cộng trừ", "±", "\\pm"],
      ["Không bằng", "≠", "\\ne"], ["Xấp xỉ", "≈", "\\approx"], ["Nhỏ hơn hoặc bằng", "≤", "\\le"],
      ["Lớn hơn hoặc bằng", "≥", "\\ge"], ["Vô cực", "∞", "\\infty"], ["Độ", "°", "^{\\circ}"],
      ["Pi", "π", "\\pi"], ["Căn", "√", "\\sqrt{}"], ["Tổng", "∑", "\\sum"],
    ],
  },
  {
    id: "greek", label: "Hy Lạp", items: [
      ["Alpha", "α", "\\alpha"], ["Beta", "β", "\\beta"], ["Gamma", "γ", "\\gamma"],
      ["Delta", "δ", "\\delta"], ["Epsilon", "ε", "\\varepsilon"], ["Theta", "θ", "\\theta"],
      ["Lambda", "λ", "\\lambda"], ["Mu", "μ", "\\mu"], ["Nu", "ν", "\\nu"],
      ["Xi", "ξ", "\\xi"], ["Pi", "π", "\\pi"], ["Rho", "ρ", "\\rho"],
      ["Sigma", "σ", "\\sigma"], ["Tau", "τ", "\\tau"], ["Phi", "φ", "\\varphi"],
      ["Chi", "χ", "\\chi"], ["Psi", "ψ", "\\psi"], ["Omega", "ω", "\\omega"],
      ["Gamma hoa", "Γ", "\\Gamma"], ["Delta hoa", "Δ", "\\Delta"], ["Theta hoa", "Θ", "\\Theta"],
      ["Lambda hoa", "Λ", "\\Lambda"], ["Sigma hoa", "Σ", "\\Sigma"], ["Phi hoa", "Φ", "\\Phi"],
      ["Psi hoa", "Ψ", "\\Psi"], ["Omega hoa", "Ω", "\\Omega"],
    ],
  },
  {
    id: "relations", label: "Quan hệ", items: [
      ["Bằng", "=", "="], ["Không bằng", "≠", "\\ne"], ["Xấp xỉ", "≈", "\\approx"],
      ["Tương đương", "≡", "\\equiv"], ["Tỷ lệ", "∝", "\\propto"], ["Nhỏ hơn", "<", "<"],
      ["Lớn hơn", ">", ">"], ["Nhỏ hơn hoặc bằng", "≤", "\\le"], ["Lớn hơn hoặc bằng", "≥", "\\ge"],
      ["Rất nhỏ", "≪", "\\ll"], ["Rất lớn", "≫", "\\gg"], ["Song song", "∥", "\\parallel"],
      ["Vuông góc", "⊥", "\\perp"],
    ],
  },
  {
    id: "operators", label: "Phép toán", items: [
      ["Nhân chấm", "·", "\\cdot"], ["Nhân", "×", "\\times"], ["Chia", "÷", "\\div"],
      ["Cộng trừ", "±", "\\pm"], ["Trừ cộng", "∓", "\\mp"], ["Tích chập", "∗", "\\ast"],
      ["Tổng", "∑", "\\sum"], ["Tích", "∏", "\\prod"], ["Tích phân", "∫", "\\int"],
      ["Tích phân kép", "∬", "\\iint"], ["Đạo hàm riêng", "∂", "\\partial"], ["Nabla", "∇", "\\nabla"],
      ["Vô cực", "∞", "\\infty"], ["Giai thừa", "!", "!"], ["Phần trăm", "%", "\\%"],
    ],
  },
  {
    id: "sets", label: "Tập hợp & logic", items: [
      ["Thuộc", "∈", "\\in"], ["Không thuộc", "∉", "\\notin"], ["Chứa", "∋", "\\ni"],
      ["Tập con", "⊂", "\\subset"], ["Tập con hoặc bằng", "⊆", "\\subseteq"], ["Hợp", "∪", "\\cup"],
      ["Giao", "∩", "\\cap"], ["Tập rỗng", "∅", "\\varnothing"], ["Mọi", "∀", "\\forall"],
      ["Tồn tại", "∃", "\\exists"], ["Không tồn tại", "∄", "\\nexists"], ["Và", "∧", "\\land"],
      ["Hoặc", "∨", "\\lor"], ["Phủ định", "¬", "\\neg"], ["Suy ra", "⇒", "\\Rightarrow"],
      ["Tương đương logic", "⇔", "\\Leftrightarrow"], ["Số tự nhiên", "ℕ", "\\mathbb{N}"],
      ["Số nguyên", "ℤ", "\\mathbb{Z}"], ["Số hữu tỷ", "ℚ", "\\mathbb{Q}"], ["Số thực", "ℝ", "\\mathbb{R}"],
      ["Số phức", "ℂ", "\\mathbb{C}"],
    ],
  },
  {
    id: "arrows", label: "Mũi tên", items: [
      ["Trái", "←", "\\leftarrow"], ["Phải", "→", "\\rightarrow"], ["Hai chiều", "↔", "\\leftrightarrow"],
      ["Lên", "↑", "\\uparrow"], ["Xuống", "↓", "\\downarrow"], ["Suy ra", "⇒", "\\Rightarrow"],
      ["Tương đương", "⇔", "\\Leftrightarrow"], ["Ánh xạ tới", "↦", "\\mapsto"],
    ],
  },
  {
    id: "science", label: "Kỹ thuật", items: [
      ["Độ", "°", "^{\\circ}"], ["Phút góc", "′", "^{\\prime}"], ["Giây góc", "″", "^{\\prime\\prime}"],
      ["Micro", "µ", "\\mu"], ["Ohm", "Ω", "\\Omega"], ["Angstrom", "Å", "\\mathring{A}"],
      ["Tam giác", "△", "\\triangle"], ["Góc", "∠", "\\angle"], ["Vuông góc", "⊥", "\\perp"],
      ["Song song", "∥", "\\parallel"], ["Xấp xỉ", "≈", "\\approx"],
    ],
  },
  {
    id: "formulas", label: "Mẫu công thức", items: [
      ["Phân số (chia phần)", "a⁄b", "\\frac{a}{b}", "formula"],
      ["Căn bậc hai", "√x", "\\sqrt{x}", "formula"],
      ["Căn bậc n", "ⁿ√x", "\\sqrt[n]{x}", "formula"],
      ["Lũy thừa", "xⁿ", "x^{n}", "formula"],
      ["Chỉ số dưới", "xₙ", "x_{n}", "formula"],
      ["Trị tuyệt đối", "|x|", "\\left|x\\right|", "formula"],
      ["Tổng có cận", "Σ", "\\sum_{i=1}^{n} x_i", "formula"],
      ["Tích phân có cận", "∫", "\\int_{a}^{b} f(x)\\,dx", "formula"],
      ["Giới hạn", "lim", "\\lim_{x \\to a} f(x)", "formula"],
      ["Đạo hàm", "dy/dx", "\\frac{dy}{dx}", "formula"],
      ["Vector", "v⃗", "\\vec{v}", "formula"],
      ["Ma trận 2×2", "[a b; c d]", "\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}", "formula"],
      ["Hệ phương trình", "{…", "\\begin{cases}a_1x+b_1y=c_1\\\\a_2x+b_2y=c_2\\end{cases}", "formula"],
    ],
  },
].map((group) => ({
  ...group,
  items: group.items.map(([label, symbol, latex, kind = "symbol"]) => ({
    label, symbol, latex, kind,
    search: `${label} ${symbol} ${latex}`.toLocaleLowerCase("vi"),
  })),
}));

export function insertionFor(item, target) {
  if (target?.matches?.("[data-latex]")) return item.latex;
  if (target?.matches?.("[data-simple]")) {
    const simple = {
      "\\times": "*", "\\cdot": "*", "\\div": "/", "\\sqrt{}": "sqrt()",
      "\\pi": "pi", "\\infty": "Infinity", "\\ne": "!=", "\\le": "<=", "\\ge": ">=",
    }[item.latex];
    return simple || item.symbol;
  }
  return item.kind === "formula" ? `$${item.latex}$` : item.symbol;
}
