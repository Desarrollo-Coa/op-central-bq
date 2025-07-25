import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(request: Request) {
  try {
    const cumplidos = await request.json();

    if (!Array.isArray(cumplidos)) {
      return NextResponse.json({ error: 'El cuerpo debe ser un array de cumplidos' }, { status: 400 });
    }

    let creados = 0;
    let actualizados = 0;
    let errores: any[] = [];

    for (const body of cumplidos) {
      const { id_puesto, fecha, id_tipo_turno, id_colaborador } = body;

      if (!id_puesto || !fecha || !id_tipo_turno) {
        errores.push({ id_puesto, error: 'Faltan id_puesto, fecha o id_tipo_turno' });
        continue;
      }

      // Validar que id_puesto e id_tipo_turno sean números
      if (isNaN(Number(id_puesto)) || isNaN(Number(id_tipo_turno))) {
        errores.push({ id_puesto, error: 'id_puesto e id_tipo_turno deben ser números válidos' });
        continue;
      }

      // Validar id_colaborador: puede ser null (para desasignar)
      if (id_colaborador === undefined) {
        return NextResponse.json({ error: 'Falta id_colaborador en algún registro' }, { status: 400 });
      }

      let fechaFormateada;
      try {
        const fechaObj = new Date(fecha);
        if (isNaN(fechaObj.getTime())) throw new Error('Fecha inválida');
        fechaFormateada = fechaObj.toISOString().split('T')[0];
      } catch (e) {
        errores.push({ id_puesto, error: 'Formato de fecha inválido' });
        continue;
      }

      // Log antes de procesar cada registro
      console.log('[BATCH] Procesando:', { id_puesto, fecha: fechaFormateada, id_tipo_turno, id_colaborador });

      if (id_colaborador === undefined || id_colaborador === null || (typeof id_colaborador === 'string' && id_colaborador.trim() === '')) {
        // Verificar si ya existe un registro para este puesto, fecha y turno
        const [existing] = await pool.query(
          'SELECT id_cumplido FROM cumplidos WHERE id_puesto = ? AND fecha = ? AND id_tipo_turno = ?',
          [id_puesto, fechaFormateada, id_tipo_turno]
        ) as [any[], any];

        if (existing && existing.length > 0) {
          const registroExistente = existing[0];
          const [notas] = await pool.query(
            'SELECT id_nota FROM notas_cumplidos WHERE id_cumplido = ?',
            [registroExistente.id_cumplido]
          ) as [any[], any];
          if (!notas || notas.length === 0) {
            await pool.query(
              'DELETE FROM cumplidos WHERE id_cumplido = ?',
              [registroExistente.id_cumplido]
            );
            console.log('[BATCH] Eliminado registro vacío sin notas:', registroExistente.id_cumplido);
            continue;
          } else {
            await pool.query(
              'UPDATE cumplidos SET id_colaborador = NULL WHERE id_cumplido = ?',
              [registroExistente.id_cumplido]
            );
            console.log('[BATCH] Limpiado colaborador pero conservado registro por tener notas:', registroExistente.id_cumplido);
            actualizados++;
            continue;
          }
        } else {
          console.log('[BATCH] No existe registro para limpiar/eliminar, se omite:', { id_puesto, fecha: fechaFormateada, id_tipo_turno });
          continue;
        }
      } else {
        try {
          // Verificar si ya existe un registro para este puesto, fecha y turno
          const [existing] = await pool.query(
            'SELECT id_cumplido FROM cumplidos WHERE id_puesto = ? AND fecha = ? AND id_tipo_turno = ?',
            [id_puesto, fechaFormateada, id_tipo_turno]
          ) as [any[], any];

          if (existing && existing.length > 0) {
            await pool.query(
              `UPDATE cumplidos SET id_colaborador = ?
               WHERE id_puesto = ? AND fecha = ? AND id_tipo_turno = ?`,
              [id_colaborador || null, id_puesto, fechaFormateada, id_tipo_turno]
            );
            console.log('[BATCH] Actualizado:', { id_puesto, fecha: fechaFormateada, id_tipo_turno });
            actualizados++;
          } else {
            await pool.query(
              `INSERT INTO cumplidos (fecha, id_puesto, id_tipo_turno, id_colaborador)
               VALUES (?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE id_colaborador = VALUES(id_colaborador)`,
              [fechaFormateada, id_puesto, id_tipo_turno, id_colaborador]
            );
            console.log('[BATCH] Insertado:', { id_puesto, fecha: fechaFormateada, id_tipo_turno });
            creados++;
          }
        } catch (error) {
          console.error('[BATCH] Error en operación:', { id_puesto, fecha: fechaFormateada, id_tipo_turno, error });
          errores.push({ id_puesto, error: error instanceof Error ? error.message : 'Error desconocido' });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      creados,
      actualizados,
      errores,
    });
  } catch (error) {
    console.error('Error en batch cumplidos:', error);
    return NextResponse.json(
      { error: 'Error al procesar la petición', details: error instanceof Error ? error.message : 'Error desconocido' },
      { status: 500 }
    );
  }
}