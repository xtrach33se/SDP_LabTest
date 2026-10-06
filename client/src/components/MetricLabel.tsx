const definitions: Record<string, string> = {
  'Lines added': 'l⁺ — total lines introduced by commits in the selected set.',
  'Lines removed': 'l⁻ — total lines deleted by commits in the selected set.',
  'Net growth': 'δ = l⁺ − l⁻ — net change in line count.',
  'Total churn': 'λ = l⁺ + l⁻ — total code movement.',
  Churn: 'λ = l⁺ + l⁻ — total code movement.',
  Modifications: 'n — commits in the selected set that changed this object.',
  'Modification frequency': 'η = n / |H| — fraction of selected commits that modified this object.',
  'Churn rate': 'ρ = λ / |H| — average churn per selected commit.',
  Ownership: 'c = author churn / total churn — contribution share for the selected object.',
  Commits: '|H| — number of commits in the current filtered set.',
};

export default function MetricLabel({ children }: { children: string }) {
  return <span className="cursor-help" title={definitions[children] ?? children}>{children}</span>;
}
