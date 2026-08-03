import LogoImage from '@/assets/gridvision-logo.png';

interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({
  size = 150,
  className = '',
}: LogoProps) {
  return (
    <img
      src={LogoImage}
      alt="GridVision"
      width={size}
      className={className}
    />
  );
}