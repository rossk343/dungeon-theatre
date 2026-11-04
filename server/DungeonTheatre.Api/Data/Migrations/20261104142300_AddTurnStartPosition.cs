using DungeonTheatre.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DungeonTheatre.Api.Data.Migrations;

[DbContext(typeof(GameDbContext))]
[Migration("20261104142300_AddTurnStartPosition")]
public partial class AddTurnStartPosition : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<double>(
            name: "TurnStartX",
            table: "Encounters",
            type: "REAL",
            nullable: true);

        migrationBuilder.AddColumn<double>(
            name: "TurnStartY",
            table: "Encounters",
            type: "REAL",
            nullable: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "TurnStartX",
            table: "Encounters");

        migrationBuilder.DropColumn(
            name: "TurnStartY",
            table: "Encounters");
    }
}
