using DungeonTheatre.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DungeonTheatre.Api.Data.Migrations;

[DbContext(typeof(GameDbContext))]
[Migration("20261104161400_AddTokenArmorClass")]
public partial class AddTokenArmorClass : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<int>(
            name: "ArmorClass",
            table: "Tokens",
            type: "INTEGER",
            nullable: false,
            defaultValue: 10);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "ArmorClass",
            table: "Tokens");
    }
}
