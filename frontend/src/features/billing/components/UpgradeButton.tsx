import { useNavigate } from 'react-router-dom'
import { useCreateCheckout } from '../hooks/useBilling'
import { useAppStore } from '@/app/store/useAppStore'

interface Props {
  priceId: string
  children?: React.ReactNode
}

export const UpgradeButton = ({ priceId, children }: Props): JSX.Element => {
  const createCheckout = useCreateCheckout()
  const token = useAppStore((s) => s.token)
  const navigate = useNavigate()

  const isDisabled = !priceId

  const handleClick = async () => {
    if (!priceId) {
      console.error('Missing Stripe price ID. Set VITE_STRIPE_PRO_PRICE_ID in the frontend environment.')
      return
    }

    if (!token) {
      navigate('/login?plan=pro&returnUrl=/pricing')
      return
    }

    try {
      const res = await createCheckout.mutateAsync(priceId)
      if (res?.url) {
        window.location.href = res.url
      }
    } catch (error) {
      console.error(error)
    }
  }

  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={handleClick}
      className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg transition-all ${
        isDisabled
          ? 'cursor-not-allowed bg-slate-700/80 shadow-none'
          : 'bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 shadow-indigo-500/20'
      }`}
    >
      {children ?? 'Upgrade to Pro'}
    </button>
  )
}
