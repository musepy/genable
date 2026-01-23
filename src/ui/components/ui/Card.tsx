import { h, ComponentChildren } from 'preact';
import { tokens } from '../../design-system/tokens';

export interface CardProps {
  children?: ComponentChildren;
  className?: string;
  style?: h.JSX.CSSProperties;
}

export interface CardHeaderProps {
  children?: ComponentChildren;
  style?: h.JSX.CSSProperties;
}

export interface CardTitleProps {
  children?: ComponentChildren;
  style?: h.JSX.CSSProperties;
}

export interface CardDescriptionProps {
  children?: ComponentChildren;
  style?: h.JSX.CSSProperties;
}

export interface CardContentProps {
  children?: ComponentChildren;
  style?: h.JSX.CSSProperties;
}

export interface CardFooterProps {
  children?: ComponentChildren;
  style?: h.JSX.CSSProperties;
}

/**
 * Card Container - shadcn style
 * Uses CSS variables for automatic light/dark mode
 */
export function Card({ children, style, ...props }: CardProps) {
  const cardStyle: h.JSX.CSSProperties = {
    background: 'var(--card)',
    color: 'var(--card-foreground)',
    borderRadius: 'var(--radius-3)',
    border: `1px solid var(--border)`,
    boxShadow: 'var(--card-shadow)',
    // Note: Removed overflow: hidden to allow Popovers to float above
    ...style,
  };

  return (
    <div style={cardStyle} {...props}>
      {children}
    </div>
  );
}

/**
 * Card Header - contains title and description
 */
export function CardHeader({ children, style }: CardHeaderProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: tokens.space[1],
      padding: tokens.space[5],
      ...style,
    }}>
      {children}
    </div>
  );
}

/**
 * Card Title - H3 style heading
 */
export function CardTitle({ children, style }: CardTitleProps) {
  return (
    <h3 style={{
      margin: 0,
      fontSize: tokens.fontSize[3],
      fontWeight: tokens.fontWeight.semibold,
      lineHeight: tokens.lineHeight[1],
      fontFamily: tokens.font.sans,
      color: 'var(--foreground)',
      ...style,
    }}>
      {children}
    </h3>
  );
}

/**
 * Card Description - Muted text below title
 */
export function CardDescription({ children, style }: CardDescriptionProps) {
  return (
    <p style={{
      margin: 0,
      fontSize: tokens.fontSize[1],
      color: 'var(--muted-foreground)',
      fontFamily: tokens.font.sans,
      lineHeight: tokens.lineHeight[2],
      ...style,
    }}>
      {children}
    </p>
  );
}

/**
 * Card Content - Main content area
 */
export function CardContent({ children, style }: CardContentProps) {
  return (
    <div style={{
      padding: tokens.space[5],
      paddingTop: 0, // No double padding with header
      ...style,
    }}>
      {children}
    </div>
  );
}

/**
 * Card Footer - Actions area
 */
export function CardFooter({ children, style }: CardFooterProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: tokens.space[2],
      padding: tokens.space[5],
      paddingTop: 0,
      ...style,
    }}>
      {children}
    </div>
  );
}
