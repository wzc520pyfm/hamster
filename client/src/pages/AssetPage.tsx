import { useParams } from 'react-router-dom'
import { DashboardView } from '@/components/DashboardView'
import type { Locale } from '@/i18n/messages'

export function AssetPage({ locale }: { locale: Locale }) {
  const { assetId } = useParams()
  if (!assetId) return null
  return <DashboardView assetId={assetId} locale={locale} />
}
