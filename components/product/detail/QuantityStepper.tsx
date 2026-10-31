"use client";

interface QuantityStepperProps {
  quantity: number;
  max: number;
  onIncrement: () => void;
  onDecrement: () => void;
}

/**
 * Square stepper, identical in build to the one in the cart so the control
 * behaves and looks the same on both sides of the add-to-cart action.
 *
 * The spring-scale animation on the number was removed: it re-ran on every tap
 * of a control users often tap several times quickly, and a number that bounces
 * while you are still counting is harder to read, not more delightful.
 */
export default function QuantityStepper({
  quantity,
  max,
  onIncrement,
  onDecrement,
}: QuantityStepperProps) {
  return (
    <div className="inline-flex items-center border border-krov-edge">
      <StepBtn
        onClick={onDecrement}
        disabled={quantity <= 1}
        label="Disminuir cantidad"
      >
        −
      </StepBtn>
      <span className="grid w-8 place-items-center text-center text-sm tabular-nums text-krov-bone md:block md:w-10">
        {quantity}
      </span>
      <StepBtn
        onClick={onIncrement}
        disabled={quantity >= max}
        label="Aumentar cantidad"
      >
        +
      </StepBtn>
    </div>
  );
}

function StepBtn({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid h-12 w-10 place-items-center md:h-11 md:w-11 text-base text-krov-ash transition-colors hover:bg-krov-graphite hover:text-krov-bone disabled:opacity-25 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
